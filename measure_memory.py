#!/usr/bin/env python3
# Copyright 2026 the V8 project authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

from __future__ import annotations

import argparse
import colorsys
import os
import psutil  # type: ignore[import-untyped]
import queue
import re
import shlex
import shutil
import statistics
import subprocess
import sys
import threading
import time
from enum import Enum, IntEnum, auto
from pathlib import Path
from typing import IO, Any, Iterator, Optional, cast

COMBINED_TEST_NAME = "JetStream3 (Combined)"


class Engine(Enum):
  V8 = auto()
  JSC = auto()
  SPIDERMONKEY = auto()
  UNKNOWN = auto()

  @classmethod
  def detect(cls, engine_path: Path) -> Engine:
    name = engine_path.name.lower()
    if "d8" in name or "v8" in name:
      return Engine.V8
    elif "jsc" in name:
      return Engine.JSC
    elif "spidermonkey" in name or "js" == name:
      return Engine.SPIDERMONKEY
    return Engine.UNKNOWN


class DataPointAnnotation(IntEnum):
  NONE = 0
  MINOR_GC = 1
  MAJOR_GC = 2


class DataPoint:
  """Represents a single memory measurement with associated GC and workload annotations."""

  def __init__(
      self,
      rss: float = 0,
      annotation: DataPointAnnotation = DataPointAnnotation.NONE,
      workload_idx: int = 0,
      is_new_workload: bool = False,
  ):
    self.rss = rss
    self.annotation = annotation
    self.workload_idx = workload_idx
    self.is_new_workload = is_new_workload

  def merge(self, other: "DataPoint"):
    self.rss = max(self.rss, other.rss)
    self.annotation = max(self.annotation, other.annotation)
    if other.is_new_workload:
      if not self.is_new_workload:
        self.workload_idx = other.workload_idx
        self.is_new_workload = True
    elif not self.is_new_workload:
      self.workload_idx = max(self.workload_idx, other.workload_idx)


class Terminal:
  """
  Provides utility methods for ANSI terminal color constants and cursor control.
  """
  RED = "\033[31m"
  YELLOW = "\033[33m"
  RESET = "\033[0m"

  @classmethod
  def move_cursor_up(cls, lines: int) -> None:
    sys.stdout.write(f"\033[{lines}F")

  @classmethod
  def erase_line(cls) -> None:
    sys.stdout.write("\033[K")


class ResultsTableView:
  """
  Handles the formatting and display of benchmark result tables and
  aggregate summaries.
  """

  PARTS = [
      ("Test Name", "<33"),
      ("Score", ">11"),
      ("Median ⌀", ">9"),
      ("Peak ▲", ">9"),
  ]

  @classmethod
  def get_parts(cls, sparkline: bool = False) -> list[tuple[str, str]]:
    parts = list(cls.PARTS)
    if sparkline:
      parts.append(("History", "<12"))
    return parts

  @classmethod
  def print_header(cls, sparkline: bool = False) -> None:
    parts = cls.get_parts(sparkline)
    header = " │ ".join(f"{name:{pad}}" for name, pad in parts)
    sys.stdout.write(header + "\n")
    separator = "─┼─".join("─" * int(pad[1:]) for _, pad in parts)
    sys.stdout.write(separator + "\n")

  @classmethod
  def print_line(
      cls,
      name_col: str,
      score_col: str,
      median_col: str,
      peak_col: str,
      history_col: str = "",
      sparkline: bool = False,
      end_separator: bool = False,
  ) -> None:
    parts = cls.get_parts(sparkline)
    values = [name_col, score_col, median_col, peak_col]
    if sparkline:
      values.append(history_col)
    line = " │ ".join(f"{str(val):{pad}}"
                      for val, (_, pad) in zip(values, parts))
    if end_separator:
      line += " │"
    sys.stdout.write(f"{line}\n")

  @classmethod
  def print_summary(cls, workloads: list[Workload]) -> None:
    if not workloads:
      return
    print("")
    print("")

    # Separate dummy summary workloads from regular ones
    summary_workload = None
    if workloads[-1].is_summary():
      summary_workload = workloads.pop()
    regular_workloads = workloads
    assert not any(
        w.is_summary()
        for w in regular_workloads), ("Got more than one summary workload")

    cls.print_header()
    sorted_workloads = sorted(regular_workloads,
                              key=lambda w: w.max_rss,
                              reverse=True)
    for workload in sorted_workloads:
      workload.print()

    all_max_rss_mb = [w.max_rss_mb for w in regular_workloads]
    all_median_mb = [w.median_rss_mb for w in regular_workloads]
    all_scores = [w.score for w in regular_workloads if w.score is not None]
    if not all_max_rss_mb:
      return
    g_min_max = min(all_max_rss_mb)
    g_med_max = statistics.median(all_max_rss_mb)
    g_max_max = max(all_max_rss_mb)
    g_sum_max = sum(all_max_rss_mb)

    g_min_med = min(all_median_mb)
    g_med_med = statistics.median(all_median_mb)
    g_max_med = max(all_median_mb)
    g_sum_med = sum(all_median_mb)

    overall_score_str = ""
    if summary_workload is not None and summary_workload.score is not None:
      overall_score_str = f"{summary_workload.score:.2f} pts"
    elif all_scores:
      # JetStream uses geometric mean for aggregation
      product = 1.0
      for s in all_scores:
        product *= s
      overall_score = product**(1.0 / len(all_scores))
      overall_score_str = f"{overall_score:.2f} pts"

    print("")
    print(f"{'OVERALL Minimum:':<40} {'':>12} {g_min_med:>12} {g_min_max:>12}")
    print(
        f"{'OVERALL Median:':<40} {'':>12} {g_med_med:>12.0f} {g_med_max:>12.0f}"
    )
    print(f"{'OVERALL Maximum:':<40} {'':>12} {g_max_med:>12} {g_max_max:>12}")
    print(f"{'OVERALL Score:':<40} {overall_score_str:>12}")
    print(f"{'OVERALL Sum:':<40} {'':>12} {g_sum_med:>12} {g_sum_max:>12}")


class Workload:
  """Tracks the memory history and score of a single benchmark workload."""
  SUMMARY_NAME = "Summary"

  @classmethod
  def summary(cls, score: float) -> Workload:
    return Workload(cls.SUMMARY_NAME, -1, score=score)

  def __init__(self, name: str, index: int, score: Optional[float] = None):
    self.name = name
    self.index = index
    self.timeline: list[DataPoint] = []
    self.max_rss: float = 0
    self.score: Optional[float] = score
    if self.is_summary():
      assert self.name == self.SUMMARY_NAME, "Invalid summary workload name"

  def is_summary(self) -> bool:
    return self.index == -1

  def add_data_point(self, data_point: DataPoint):
    self.timeline.append(data_point)
    if data_point.rss > self.max_rss:
      self.max_rss = data_point.rss

  @property
  def median_rss(self) -> float:
    if not self.timeline:
      return 0
    return statistics.median([data_point.rss for data_point in self.timeline])

  @property
  def median_rss_mb(self) -> int:
    return int(self.median_rss // 1024)

  @property
  def max_rss_mb(self) -> int:
    return int(self.max_rss // 1024)

  @property
  def score_str(self) -> str:
    if self.score is None:
      return ""
    return f"{self.score:.2f} pts"

  def print(self, sparkline: bool = False) -> None:
    name_col = f"{self.index:02d} {self.name}"
    score_col = self.score_str
    median_col = f"{self.median_rss_mb} MB ⌀"
    peak_col = f"{self.max_rss_mb} MB ▲"
    history_col = TimelineView.get_sparkline(
        self.timeline) if sparkline else ""
    Terminal.erase_line()
    ResultsTableView.print_line(name_col, score_col, median_col, peak_col,
                                history_col, sparkline)


POLL_INTERVAL_SECONDS = 0.1

JS_FLAG_PREFIXES = (
    "--tag",
    "--test",
    "--iteration",
    "--worst",
    "--dump-test-list",
    "--force-gc",
    "--no-prefetch",
    "--worst-case-count",
    "--iteration-count",
)
IGNORED_TEST_PATTERNS = [
    "---",
    "Profiling",
    "block",
    "Warning:",
    "Try --help",
    "Starting JetStream3",
]


class TimelineView:
  """Helper methods to render memory timelines and sparklines."""

  HEIGHT = 4
  BLOCK_HEIGHT = HEIGHT + 2
  LABEL_PADDING = "       "
  SPARKLINE_CHARS = " ▂▃▄▅▆▇█"

  @classmethod
  def get_color(cls, v: float, max_v: float = 8 * 1024 * 1024) -> str:
    """Interpolate colors using a piecewise HSV-based spiral."""
    t = max(0, min(1.0, v / max_v))
    hue = (199 + (t * 5 * 360)) % 360

    # Piecewise saturation and value
    if t < 0.5:
      sat = 0.36 + (t * 2 * 0.64)
      val = 0.27 + (t * 2 * 0.73)
    else:
      sat = 1.0 + ((t - 0.5) * 2 * (-1.00))
      val = 1.0

    r, g, b = colorsys.hsv_to_rgb(hue / 360, sat, val)
    return f"\033[38;2;{int(r * 255)};{int(g * 255)};{int(b * 255)}m"

  @classmethod
  def compress_timeline(cls, timeline: list[DataPoint],
                        width: int) -> list[DataPoint]:
    """Compresses a larger timeline into smaller one."""
    if not timeline:
      return []
    if len(timeline) <= width:
      return timeline
    chunk_size = len(timeline) / width
    compressed = []
    for i in range(width):
      start = int(i * chunk_size)
      end = int((i + 1) * chunk_size)
      if chunk := timeline[start:end]:
        data_point = DataPoint(
            chunk[0].rss,
            chunk[0].annotation,
            chunk[0].workload_idx,
            chunk[0].is_new_workload,
        )
        for other in chunk[1:]:
          data_point.merge(other)
        compressed.append(data_point)
    return compressed

  @classmethod
  def get_overlay_print_line(cls, timeline: list[DataPoint],
                             show_markers: bool) -> list[Optional[str]]:
    """
    Build horizontal text overlay for workload markers and separators
    used for the first graph line."""
    overlay: list[Optional[str]] = [None] * len(timeline)
    if not show_markers:
      return overlay
    for i, data_point in enumerate(timeline):
      if not data_point.is_new_workload:
        continue
      idx = data_point.workload_idx
      if idx >= 0:
        s = f"┌{idx:02d}"
        for j, c in enumerate(s):
          if i + j < len(timeline):
            overlay[i + j] = c
    return overlay

  @classmethod
  def get_graph(
      cls,
      timeline: list[DataPoint],
      width: int,
      height: int,
      show_labels: bool = False,
      compress: bool = False,
      show_markers: bool = False,
  ) -> list[str]:
    if not timeline:
      return [" " * width] * height

    if compress:
      timeline = cls.compress_timeline(timeline, width)
    else:
      timeline = timeline

    overlay = cls.get_overlay_print_line(timeline, show_markers)

    visible_timeline: list[DataPoint] = timeline[-width:]
    visible_overlay: list[str | None] = overlay[-width:]

    if len(visible_timeline) < width:
      padding_val = visible_timeline[0].rss if visible_timeline else 0
      pad_len = width - len(visible_timeline)
      visible_timeline = [DataPoint(padding_val)] * pad_len + visible_timeline
      padding_overlay: list[str | None] = [None]
      visible_overlay = (padding_overlay * pad_len) + visible_overlay
    else:
      # Add sticky workload index at the start
      first_workload_index = visible_timeline[0].workload_idx
      if first_workload_index >= 0:
        s = f"{first_workload_index:02d}"
        visible_overlay[0:len(s)] = list(s)

    rss_vals = [data_point.rss for data_point in visible_timeline]
    min_val, max_val = min(rss_vals), max(rss_vals)
    if max_val == min_val:
      max_val = min_val + 1024

    # For multi-line overview charts, snap min/max to 100MB boundaries.
    if height > 1:
      SNAP = 100 * 1024
      min_val = (min_val // SNAP) * SNAP
      max_val = ((max_val + SNAP - 1) // SNAP) * SNAP
      if max_val == min_val:
        max_val = min_val + SNAP

    val_range = max(1, max_val - min_val)
    print_lines = []

    for h in range(height, 0, -1):
      t_low = min_val + (h - 1) / height * val_range
      t_high = min_val + h / height * val_range
      line_range = max(1, t_high - t_low)

      print_line = ""
      if show_labels:
        if h == height:
          print_line = f"{cls.get_color(max_val)}{max_val // 1024:>4.0f} MB{Terminal.RESET}┐"
        elif h == 1:
          print_line = f"{cls.get_color(min_val)}{min_val // 1024:>4.0f} MB{Terminal.RESET}┘"
        else:
          print_line = f"{cls.LABEL_PADDING}│"

      for i, data_point in enumerate(visible_timeline):
        value = data_point.rss
        if show_markers:
          if h == height and (overlay_char := visible_overlay[i]):
            print_line += f"{Terminal.RESET}{overlay_char}"
            continue

          if data_point.is_new_workload:
            print_line += f"{Terminal.RESET}│{Terminal.RESET}"
            continue

        if value <= t_low and h > 1:
          print_line += " "
          continue

        if value <= 0:
          print_line += " "
          continue

        if value >= t_high:
          char = cls.SPARKLINE_CHARS[-1]
        else:
          if height == 1:
            idx_char = int(((value - min_val) / val_range) *
                           (len(cls.SPARKLINE_CHARS) - 1))
          else:
            idx_char = int(((value - t_low) / line_range) *
                           (len(cls.SPARKLINE_CHARS) - 1))
          if h == 1 and idx_char <= 0 and value > 0:
            idx_char = 1
          char = cls.SPARKLINE_CHARS[idx_char]

        if data_point.annotation == DataPointAnnotation.MAJOR_GC:
          print_line += f"{Terminal.RED}{char}{Terminal.RESET}"
        elif data_point.annotation == DataPointAnnotation.MINOR_GC:
          print_line += f"{Terminal.YELLOW}{char}{Terminal.RESET}"
        else:
          print_line += f"{cls.get_color(value)}{char}{Terminal.RESET}"
      print_lines.append(print_line)

    if show_labels and show_markers:
      print_lines.append(
          f"{cls.LABEL_PADDING} {cls.get_annotation_print_line(visible_timeline)}"
      )

    return print_lines

  @classmethod
  def get_annotation_print_line(cls, data: list[DataPoint]) -> str:
    """Last line in a graph with annotation symbols."""
    annotation_line = ""
    for data_point in data:
      if data_point.annotation == DataPointAnnotation.MAJOR_GC:
        annotation_line += f"{Terminal.RED}♻{Terminal.RESET}"
      elif data_point.annotation == DataPointAnnotation.MINOR_GC:
        annotation_line += f"{Terminal.YELLOW}♻{Terminal.RESET}"
      elif data_point.is_new_workload:
        annotation_line += f"{Terminal.RESET}│{Terminal.RESET}"
      else:
        annotation_line += " "
    return annotation_line

  @classmethod
  def get_sparkline(cls, history: list[DataPoint], width: int = 12) -> str:
    """Single line compressed memory timeline / sparkline."""
    # Filter out NEW_WORKLOAD behavior and MINOR GC for sparklines.
    clean_history = []
    for data_point in history:
      annotation = data_point.annotation
      if annotation == DataPointAnnotation.MINOR_GC:
        annotation = DataPointAnnotation.NONE
      clean_history.append(
          DataPoint(data_point.rss, annotation, data_point.workload_idx,
                    False))
    return cls.get_graph(clean_history,
                         width=width,
                         height=1,
                         compress=True,
                         show_markers=False)[0]

  @classmethod
  def get_multi_line_graph(cls,
                           history: list[DataPoint],
                           height: int | None = None) -> list[str]:
    """Large multiline graph with workload markers and annotations."""
    height = height or cls.HEIGHT
    width = max(
        10,
        shutil.get_terminal_size().columns - len(cls.LABEL_PADDING) - 1)
    return cls.get_graph(
        history,
        width=width,
        height=height,
        show_labels=True,
        compress=False,
        show_markers=True,
    )


class MonitorMessageType(Enum):
  GC = auto()
  WORKLOAD_START = auto()
  SCORE = auto()
  OVERALL_SCORE = auto()


class MonitorMessage:
  """Container to pass data from the stdout/stderr pipe to the main thread."""

  def __init__(self, type: MonitorMessageType, value: Any):
    self.type = type
    self.value = value


class LineParser:
  """Parses benchmark output and pose MonitorMessages to a message_queue."""

  JETSTREAM_TEST_START_RE = re.compile(r"Running (.*):")
  JETSTREAM_SCORE_RE = re.compile(
      r"^(.*?)\s+(?:Score|Overall.*?-Score)\s+([\d.]+)\s+pts", re.M)
  JETSTREAM_OVERALL_SCORE_RE = re.compile(
      r"^(?:JetStream3|Overall)\s+Score\s*:\s*([\d.]+)\s+pts", re.I | re.M)

  def __init__(self, engine_type: Engine, message_queue: queue.Queue):
    self.message_queue = message_queue
    if engine_type == Engine.JSC:
      self.major_re = re.compile(r"FullCollection", re.I)
      self.minor_re = re.compile(r"EdenCollection", re.I)
      self.gc_mark = "[GC<"
    elif engine_type == Engine.SPIDERMONKEY:
      self.major_re = re.compile(r"GC\(T\+", re.I)
      self.minor_re = re.compile(r"MinorGCs", re.I)
      self.gc_mark = "GC"
    else:
      self.major_re = re.compile(r"Mark-compact|Mark-sweep|Full GC", re.I)
      self.minor_re = re.compile(r"Scavenge|MinorMS|Minor GC", re.I)
      self.gc_mark = "ms: "

  def post_message(self, message_type: MonitorMessageType, value: Any) -> None:
    self.message_queue.put(MonitorMessage(message_type, value))

  def parse_line(self, line: str) -> None:
    if self.gc_mark in line:
      if self.major_re.search(line):
        self.post_message(MonitorMessageType.GC, DataPointAnnotation.MAJOR_GC)
      elif self.minor_re.search(line):
        self.post_message(MonitorMessageType.GC, DataPointAnnotation.MINOR_GC)
    if match := self.JETSTREAM_TEST_START_RE.search(line):
      self.post_message(MonitorMessageType.WORKLOAD_START, match.group(1))
    if match := self.JETSTREAM_OVERALL_SCORE_RE.search(line):
      self.post_message(MonitorMessageType.OVERALL_SCORE,
                        float(match.group(1)))
    elif match := self.JETSTREAM_SCORE_RE.search(line):
      # (benchmark_name, score)
      self.post_message(
          MonitorMessageType.SCORE,
          (match.group(1).strip(), float(match.group(2))),
      )


class IOPipeWatcher(threading.Thread):
  """Background thread to read from a pipe and feed lines to the LineParser."""

  def __init__(self, pipe: IO[bytes], parser: LineParser):
    super().__init__(daemon=True)
    self.pipe = pipe
    self.parser = parser

  def run(self):
    pending = ""
    try:
      while chunk := self.read_chunk():
        lines = (pending + chunk).split("\n")
        pending = lines.pop()
        for line in lines:
          self.parser.parse_line(line)
    except Exception:
      pass

  def read_chunk(self) -> str:
    return os.read(self.pipe.fileno(), 4096).decode("utf-8", errors="ignore")


SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]


def spinner() -> Iterator[str]:
  while True:
    for char in SPINNER_CHARS:
      yield char


class Runner:
  """
  Executes the benchmark engine and aggregates memory measurements over time.
  """

  POLL_INTERVAL_SECONDS: float = 0.1

  @classmethod
  def get_test_list(cls, engine_path: Path, engine_type: Engine,
                    extra_args: list[str]) -> list[str]:
    separator = ["--"] if engine_type in (Engine.V8, Engine.JSC) else []
    cmd = [str(engine_path)]
    cmd += ["./cli.js"] + separator + ["--dump-test-list"] + extra_args
    raw_lines = (subprocess.run(cmd,
                                capture_output=True,
                                text=True,
                                check=True).stdout.strip().splitlines())
    tests = [
        t.strip() for t in raw_lines
        if t.strip() and not any(p in t for p in IGNORED_TEST_PATTERNS)
    ]
    if not tests:
      raise Exception(f"No tests found matching: {shlex.join(cmd)}")
    return tests

  @classmethod
  def measure_test(
      cls,
      engine_path: Path,
      engine_type: Engine,
      test_name: str,
      engine_flags: list[str],
      cli_js_args: list[str],
      combined: bool = False,
      start_index: int = 1,
  ) -> list[Workload]:
    env = os.environ.copy()
    if engine_type == Engine.SPIDERMONKEY:
      env["MOZ_GCTIMER"] = "stdout"
    engine_flags_copy = list(engine_flags)
    if engine_type == Engine.JSC and "--logGC=1" not in engine_flags_copy:
      engine_flags_copy.append("--logGC=1")
    if engine_type == Engine.V8 and "--force-gc" in cli_js_args:
      if "--expose-gc" not in engine_flags_copy:
        engine_flags_copy.append("--expose-gc")
    separator = ["--"] if engine_type in (Engine.V8, Engine.JSC) else []
    cmd = [str(engine_path)] + engine_flags_copy + ["./cli.js"] + separator
    if not combined:
      cmd.append(f"--test={test_name}")
    cmd.extend(cli_js_args)
    try:
      return cls(cmd, env, engine_type, test_name, start_index).run()
    except Exception as e:
      print(f"\n ERROR: {e}")
    return []

  def __init__(
      self,
      cmd: list[str],
      env: dict[str, str],
      engine_type: Engine,
      test_name: str,
      start_index: int,
  ):
    self.process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
        bufsize=0,
        env=env,
    )
    self.message_queue: queue.Queue[MonitorMessage] = queue.Queue()
    self.global_max_rss = 0.0
    self.global_rss_history: list[DataPoint] = []
    self.start_index = start_index
    if test_name == COMBINED_TEST_NAME:
      self.start_index = 0
    self.current_workload = Workload(test_name, self.start_index)
    self.workloads: list[Workload] = []
    self.spinner = spinner()
    self.parser = LineParser(engine_type, self.message_queue)
    assert self.process.stdout is not None
    assert self.process.stderr is not None
    self.stdout_watcher = IOPipeWatcher(self.process.stdout, self.parser)
    self.stderr_watcher = IOPipeWatcher(self.process.stderr, self.parser)
    self.stdout_watcher.start()
    self.stderr_watcher.start()

  def run(self) -> list[Workload]:
    # Allocate graph block (1 status + GRAPH_HEIGHT + 1 markers line)
    sys.stdout.write("\n" * TimelineView.BLOCK_HEIGHT)

    while self.process.poll() is None:
      start_time = time.monotonic()
      self._incremental_update()
      elapsed = time.monotonic() - start_time
      time.sleep(max(0.0, self.POLL_INTERVAL_SECONDS - elapsed))

    self.process.communicate()
    if self.process.returncode == 0:
      self._process_messages()
      self._finalize_current_test(is_final=True)
      return self.workloads
    else:
      Terminal.move_cursor_up(TimelineView.BLOCK_HEIGHT)
      Terminal.erase_line()
      print(f"{Terminal.RED}{self.current_workload.name:<33} FAILED "
            f"(code {self.process.returncode}){Terminal.RESET}")
      for _ in range(TimelineView.BLOCK_HEIGHT - 1):
        Terminal.erase_line()
        sys.stdout.write("\n")
      Terminal.move_cursor_up(TimelineView.BLOCK_HEIGHT - 1)
      sys.stdout.flush()
      return self.workloads

  def _incremental_update(self):
    current_ann, is_new_workload = self._process_messages()
    rss = self._get_total_rss_kb(self.process.pid)
    if rss <= 0:
      return
    data_point = DataPoint(rss, current_ann, self.current_workload.index,
                           is_new_workload)
    self.global_max_rss = max(self.global_max_rss, rss)
    self.global_rss_history.append(data_point)
    self.current_workload.add_data_point(data_point)
    self._incremental_update_view(rss)

  def _incremental_update_view(self, rss: float) -> None:
    spin_char = next(self.spinner)
    rss_mb = int(rss) // 1024
    name_col = f"{spin_char}  {self.current_workload.name}"
    score_col = f"{spin_char} pts"
    median_col = f"{rss_mb:>4} MB ⌀"
    peak_col = f"{int(self.global_max_rss) // 1024:>4} MB ▲"
    Terminal.move_cursor_up(TimelineView.BLOCK_HEIGHT)
    Terminal.erase_line()
    ResultsTableView.print_line(name_col,
                                score_col,
                                median_col,
                                peak_col,
                                end_separator=True)
    for line in TimelineView.get_multi_line_graph(self.global_rss_history):
      Terminal.erase_line()
      sys.stdout.write(line)
      sys.stdout.write("\n")
    sys.stdout.flush()

  def _get_total_rss_kb(self, parent_pid: int) -> float:
    total_rss = 0
    try:
      parent = psutil.Process(parent_pid)
      total_rss += parent.memory_info().rss
      for child in parent.children(recursive=True):
        total_rss += child.memory_info().rss
    except (psutil.NoSuchProcess, psutil.AccessDenied):
      pass
    return total_rss / 1024

  def _process_messages(self) -> tuple[DataPointAnnotation, bool]:
    """Drain messages posted from the IOPipeWatcher threads."""
    current_ann = DataPointAnnotation.NONE
    is_new_workload = False
    while not self.message_queue.empty():
      message = self.message_queue.get()
      ann, new_wl = self._process_message(message)
      current_ann = max(current_ann, ann)
      is_new_workload = is_new_workload or new_wl
    return current_ann, is_new_workload

  def _process_message(
      self, message: MonitorMessage) -> tuple[DataPointAnnotation, bool]:
    if message.type == MonitorMessageType.GC:
      return self._process_gc_message(message)
    elif message.type == MonitorMessageType.SCORE:
      return self._process_score_message(message)
    elif message.type == MonitorMessageType.WORKLOAD_START:
      return self._process_workload_start_message(message)
    elif message.type == MonitorMessageType.OVERALL_SCORE:
      summary = Workload.summary(score=message.value)
      self.workloads.append(summary)
    return DataPointAnnotation.NONE, False

  def _process_gc_message(
      self, message: MonitorMessage) -> tuple[DataPointAnnotation, bool]:
    return message.value, False

  def _process_score_message(
      self, message: MonitorMessage) -> tuple[DataPointAnnotation, bool]:
    # Search for matching workload by name (or use current if it matches)
    score_name, score_val = message.value
    if score_name == self.current_workload.name:
      self.current_workload.score = score_val
    else:
      for w in self.workloads:
        if w.name == score_name:
          w.score = score_val
          break
    return DataPointAnnotation.NONE, False

  def _process_workload_start_message(
      self, message: MonitorMessage) -> tuple[DataPointAnnotation, bool]:
    new_test_name = message.value
    is_new_workload = False
    if self.current_workload.name == COMBINED_TEST_NAME and (
        new_test_name != self.current_workload.name):
      self.current_workload.index = self.start_index
      self.current_workload.name = new_test_name
      self.current_workload.timeline = []
      self.current_workload.max_rss = 0
      is_new_workload = True
    elif new_test_name != self.current_workload.name:
      self._finalize_current_test()
      self.current_workload = Workload(new_test_name,
                                       self.current_workload.index + 1)
      is_new_workload = True
    return DataPointAnnotation.NONE, is_new_workload

  def _finalize_current_test(self, is_final: bool = False):
    if not self.current_workload.timeline:
      return
    self.workloads.append(self.current_workload)
    self._print_finished_workload(is_final)

  def _print_finished_workload(self, is_final):
    Terminal.move_cursor_up(TimelineView.BLOCK_HEIGHT)
    self.current_workload.print(sparkline=True)
    num_lines_to_clear = TimelineView.BLOCK_HEIGHT
    # Clear the remaining lines of the graph block
    for _ in range(num_lines_to_clear - 1):
      Terminal.erase_line()
      sys.stdout.write("\n")

  # Move cursor back up to the line immediately after the summary
    Terminal.move_cursor_up(num_lines_to_clear - 1)
    sys.stdout.flush()

    if not is_final:
      # After print_finished_test, we are at the line immediately after
      # the summary. Allocate lines for the NEXT test's graph.
      sys.stdout.write("\n" * TimelineView.BLOCK_HEIGHT)


def main() -> None:
  parser = argparse.ArgumentParser(
      description="Measure memory of JetStream3 benchmarks.",
      usage="%(prog)s <engine_path> [engine_flags...] [cli_js_args...]")
  parser.add_argument("engine_path",
                      type=Path,
                      help="Path to the JS engine executable")
  parser.add_argument("--split",
                      "--separate",
                      action="store_true",
                      default=False,
                      help="Run each benchmark in a separate engine process")

  args, unknown_args = parser.parse_known_args()

  engine_path = args.engine_path.expanduser()
  if not engine_path.exists():
    return print(f"Engine not found: {engine_path}")
  engine_type = Engine.detect(engine_path)

  cli_js_args, engine_flags = _prepare_engine_flags(engine_type, unknown_args)
  run_combined = not args.split

  if run_combined:
    tests = [COMBINED_TEST_NAME]
  else:
    tests = Runner.get_test_list(engine_path, engine_type, cli_js_args)
  print(f"Found {len(tests)} tests.")
  print(f"Engine: {engine_path} {shlex.join(engine_flags)}")
  print(f"CLI args: {shlex.join(cli_js_args)}\n")
  ResultsTableView.print_header(sparkline=True)
  results: list[Workload] = []
  try:
    for idx, test in enumerate(tests, start=1):
      if res := Runner.measure_test(
          engine_path,
          engine_type,
          test,
          engine_flags,
          cli_js_args,
          combined=run_combined,
          start_index=idx,
      ):
        results.extend(res)
  except KeyboardInterrupt:
    print("\nInterrupted.")
  ResultsTableView.print_summary(results)


def _prepare_engine_flags(
    engine_type: Engine, extra_args: list[str]) -> tuple[list[str], list[str]]:
  base_engine_flags: list[str] = []
  if engine_type == Engine.V8:
    base_engine_flags = ["--trace-gc"]
  user_engine_flags: list[str] = []
  cli_js_args: list[str] = []
  for arg in extra_args:
    if arg.startswith("--") and not any(
        arg.startswith(p) for p in JS_FLAG_PREFIXES):
      user_engine_flags.append(arg)
    elif arg.startswith("-") and not arg.startswith("--"):
      user_engine_flags.append(arg)
    else:
      cli_js_args.append(arg)
  engine_flags = base_engine_flags + user_engine_flags
  return cli_js_args, engine_flags


if __name__ == "__main__":
  main()
