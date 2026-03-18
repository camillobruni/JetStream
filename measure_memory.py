# Copyright 2026 the V8 project authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

import subprocess
import os
import sys
import time
import shutil
import statistics
import threading
import queue
import re
import psutil
import shlex
from pathlib import Path
from enum import Enum, IntEnum, auto
from typing import IO, Iterator, List, Optional, Tuple, Dict


class Engine(Enum):
  V8 = auto()
  JSC = auto()
  SPIDERMONKEY = auto()
  UNKNOWN = auto()


class GCType(IntEnum):
  NONE = 0
  MINOR = 1
  MAJOR = 2


# ANSI Colors
RED = "\033[31m"
YELLOW = "\033[33m"
RESET = "\033[0m"

POLL_INTERVAL_SECONDS = 0.25

SPARKLINE_CHARS = " ▂▃▄▅▆▇█"
SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
JS_FLAG_PREFIXES = ("--tag", "--test", "--iteration", "--worst", "--dump-test-list", "--force-gc", "--no-prefetch", "--worst-case-count", "--iteration-count")
IGNORED_TEST_PATTERNS = [
    "---", "Profiling", "block", "Warning:", "Try --help", "Starting JetStream3"
]

# GC Regexes
JSC_MAJOR_RE = re.compile(r"FullCollection", re.I)
JSC_MINOR_RE = re.compile(r"EdenCollection", re.I)
JSC_GC_MARK = "[GC<"

SM_MAJOR_RE = re.compile(r"GC\(T\+", re.I)
SM_MINOR_RE = re.compile(r"MinorGCs", re.I)
SM_GC_MARK = "GC"

V8_MAJOR_RE = re.compile(r"Mark-compact|Mark-sweep|Full GC", re.I)
V8_MINOR_RE = re.compile(r"Scavenge|MinorMS|Minor GC", re.I)
V8_GC_MARK = "ms: "


def detect_engine(engine_path: Path) -> Engine:
  name = engine_path.name.lower()
  if "d8" in name or "v8" in name:
    return Engine.V8
  elif "jsc" in name:
    return Engine.JSC
  elif "spidermonkey" in name or "js" == name:
    return Engine.SPIDERMONKEY
  return Engine.UNKNOWN


def compress_history(history: List[Tuple[float, GCType]],
                     width: int) -> List[Tuple[float, GCType]]:
  if not history:
    return []
  if len(history) <= width:
    return history
  chunk_size = len(history) / width
  compressed = []
  for i in range(width):
    start = int(i * chunk_size)
    end = int((i + 1) * chunk_size)
    chunk = history[start:end]
    if chunk:
      max_rss = max(v[0] for v in chunk)
      max_gc = max(v[1] for v in chunk)
      compressed.append((max_rss, max_gc))
  return compressed


def get_sparkline(history: List[Tuple[float, GCType]], width: int = 10) -> str:
  if not history:
    return " " * width

  data = compress_history(history, width)

  if len(data) < width:
    data = [(data[0][0] if data else 0, GCType.NONE)
            ] * (width - len(data)) + data
  rss_vals = [v[0] for v in history]
  min_val, max_val = min(rss_vals), max(rss_vals)
  val_range = max(1, max_val - min_val)
  line = ""
  for v, gc in data:
    idx = int(((v - min_val) / val_range) * (len(SPARKLINE_CHARS) - 1))
    char = SPARKLINE_CHARS[idx]
    if gc == GCType.MAJOR:
      line += f"{RED}{char}{RESET}"
    elif gc == GCType.MINOR:
      line += f"{YELLOW}{char}{RESET}"
    else:
      line += char
  return line


def get_multi_line_graph(history: List[Tuple[float, GCType]],
                         height: int = 4) -> List[str]:
  if not history:
    width = shutil.get_terminal_size().columns - 15
    return [" " * width] * height
  rss_vals = [v[0] for v in history]
  min_val, max_val = min(rss_vals), max(rss_vals)
  if max_val == min_val:
    max_val = min_val + 1
  label_max, label_min, label_mid = (
      f"{int(max_val // 1024):>4} MB ┐",
      f"{int(min_val // 1024):>4} MB ┘",
      "        │",
  )
  width = max(10, shutil.get_terminal_size().columns - len(label_max) - 2)
  data = history[-width:]
  if len(data) < width:
    data = [(data[0][0], GCType.NONE)] * (width - len(data)) + data
  lines = []
  for h in range(height, 0, -1):
    t_low = min_val + (h - 1) / height * (max_val - min_val)
    t_high = min_val + h / height * (max_val - min_val)
    line_range = max(1, t_high - t_low)
    line = label_max if h == height else (label_min if h == 1 else label_mid)
    for v, gc in data:
      if v <= t_low:
        char = " "
      elif v >= t_high:
        char = SPARKLINE_CHARS[-1]
      else:
        char = SPARKLINE_CHARS[int(
            ((v - t_low) / line_range) * (len(SPARKLINE_CHARS) - 1))]
      if gc == GCType.MAJOR:
        line += f"{RED}{char}{RESET}"
      elif gc == GCType.MINOR:
        line += f"{YELLOW}{char}{RESET}"
      else:
        line += char
    lines.append(line)
  return lines


def gc_monitor(pipe: IO[bytes], event_queue: queue.Queue,
               engine_type: Engine) -> None:
  if engine_type == Engine.JSC:
    major_re = JSC_MAJOR_RE
    minor_re = JSC_MINOR_RE
    gc_mark = JSC_GC_MARK
  elif engine_type == Engine.SPIDERMONKEY:
    # SpiderMonkey with MOZ_GCTIMER
    major_re = SM_MAJOR_RE
    minor_re = SM_MINOR_RE
    gc_mark = SM_GC_MARK
  else:
    major_re = V8_MAJOR_RE
    minor_re = V8_MINOR_RE
    gc_mark = V8_GC_MARK

  pending = ""
  try:
    while True:
      chunk = os.read(pipe.fileno(), 4096).decode("utf-8", errors="ignore")
      if not chunk:
        break
      lines = (pending + chunk).split("\n")
      pending = lines.pop()
      for line in lines:
        if gc_mark in line or (engine_type == Engine.SPIDERMONKEY
                               and "GC(" in line):
          if major_re.search(line):
            event_queue.put(GCType.MAJOR)
          elif minor_re.search(line):
            event_queue.put(GCType.MINOR)
  except Exception:
    pass


def get_test_list(engine_path: Path, engine_type: Engine,
                  extra_args: List[str]) -> List[str]:
  separator = ["--"] if engine_type in (Engine.V8, Engine.JSC) else []
  cmd = [str(engine_path)]
  if engine_type == Engine.V8 and "--force-gc" in extra_args:
    cmd.append("--expose-gc")
  cmd += ["./cli.js"] + separator + ["--dump-test-list"] + extra_args
  return (subprocess.run(cmd, capture_output=True, text=True,
                         check=True).stdout.strip().splitlines())


def get_total_rss_kb(parent_pid: int) -> float:
  """Recursively sum RSS of a process and all its children."""
  try:
    parent = psutil.Process(parent_pid)
    total_rss = parent.memory_info().rss
    for child in parent.children(recursive=True):
      total_rss += child.memory_info().rss
    return total_rss / 1024
  except (psutil.NoSuchProcess, psutil.AccessDenied):
    return 0


def get_spinner() -> Iterator[str]:
  while True:
    for char in SPINNER_CHARS:
      yield char


def move_cursor_up(lines: int = 5) -> None:
  sys.stdout.write(f"\033[{lines}F")


def print_finished_test(test_name: str, median: float, max_rss: float,
                        spark: str) -> None:
  max_rss_mb = int(max_rss) // 1024
  move_cursor_up()
  print(f"\033[K  {test_name:<31} {int(median):>12} MB ⌀ | "
        f"{max_rss_mb:>4} MB ▲ | [{spark}]")
  for _ in range(4):
    print("\033[K")
  move_cursor_up(4)
  sys.stdout.flush()


def _run_measurement(cmd: List[str], env: Dict[str, str], engine_type: Engine,
                     test_name: str) -> Tuple[Optional[float], Optional[float]]:
  process = subprocess.Popen(
      cmd,
      stdout=subprocess.PIPE,
      stderr=subprocess.PIPE,
      text=True,
      bufsize=0,
      env=env,
  )
  gc_q = queue.Queue()
  threading.Thread(target=gc_monitor,
                   args=(process.stdout, gc_q, engine_type),
                   daemon=True).start()
  threading.Thread(target=gc_monitor,
                   args=(process.stderr, gc_q, engine_type),
                   daemon=True).start()

  max_rss, rss_history = 0, []
  print("\n" * 4)

  spinner = get_spinner()

  while process.poll() is None:
    gc = GCType.NONE
    while not gc_q.empty():
      gc = max(gc, gc_q.get())

    rss = get_total_rss_kb(process.pid)
    if rss > 0:
      max_rss = max(max_rss, rss)
      rss_history.append((rss, gc))
      move_cursor_up()
      spin_char = next(spinner)
      rss_mb = int(rss) // 1024
      max_rss_mb = int(max_rss) // 1024
      print(f"\033[K{spin_char} {test_name:<31} {'':>17} | "
            f"{max_rss_mb:>4} MB ▲ | {rss_mb:>7} MB")
      for gl in get_multi_line_graph(rss_history):
        print(f"\033[K{gl}")
      sys.stdout.flush()

    time.sleep(POLL_INTERVAL_SECONDS)

  process.communicate()
  if process.returncode == 0:
    median = (int(statistics.median([v[0] for v in rss_history]) //
                  1024) if rss_history else 0)
    spark = get_sparkline(rss_history)
    print_finished_test(test_name, median, max_rss, spark)
    return median, max_rss
  else:
    move_cursor_up()
    print(f"\033[K{test_name:<33} FAILED (code {process.returncode})")
    for _ in range(4):
      print("\033[K")
    sys.stdout.flush()
    return None, None


def measure_test(
    engine_path: Path,
    engine_type: Engine,
    test_name: str,
    engine_flags: List[str],
    cli_js_args: List[str],
    combined: bool = False) -> Tuple[Optional[float], Optional[float]]:
  env = os.environ.copy()
  if engine_type == Engine.SPIDERMONKEY:
    env["MOZ_GCTIMER"] = "stdout"

  # Use --logGC=1 for jsc instead of environment variables
  engine_flags_copy = list(engine_flags)
  if engine_type == Engine.JSC and "--logGC=1" not in engine_flags_copy:
    engine_flags_copy.append("--logGC=1")

  if engine_type == Engine.V8 and "--force-gc" in cli_js_args:
    if "--expose-gc" not in engine_flags_copy:
      engine_flags_copy.append("--expose-gc")

  separator = ["--"] if engine_type in (Engine.V8, Engine.JSC) else []
  cmd = ([str(engine_path)] + engine_flags_copy + ["./cli.js"] + separator)
  if not combined:
    cmd.append(f"--test={test_name}")
  cmd.extend(cli_js_args)

  try:
    return _run_measurement(cmd, env, engine_type, test_name)
  except Exception as e:
    print(f"\n ERROR: {e}")
  return None, None


def print_summary(results: Dict[str, Tuple[float, float]],
                  engine_path: Path) -> None:
  if not results:
    return
  header_text = f"Summary for {engine_path}"
  table_width = max(70, len(header_text))
  print("\n\n" + "=" * table_width)
  print(header_text)
  print("=" * table_width)
  sorted_results = sorted(results.items(), key=lambda x: x[1][1], reverse=True)
  print(f"{'Test Name':<40} {'Median (MB)':>8} {'Peak (MB)':>8}")
  print("-" * table_width)
  for test, (median, max_rss) in sorted_results:
    print(f"{test:<40} {median:>13} {int(max_rss) // 1024:>13}")

  all_max_rss_mb = [max_rss // 1024 for median, max_rss in results.values()]
  all_median_mb = [median for median, max_rss in results.values()]

  g_min_max = min(all_max_rss_mb)
  g_med_max = int(statistics.median(all_max_rss_mb))
  g_max_max = max(all_max_rss_mb)
  g_sum_max = sum(all_max_rss_mb)

  g_min_med = min(all_median_mb)
  g_med_med = int(statistics.median(all_median_mb))
  g_max_med = max(all_median_mb)
  g_sum_med = sum(all_median_mb)

  print("-" * table_width)
  print(f"{'OVERALL Minimum:':<40} {g_min_med:>13} {g_min_max:>13}")
  print(f"{'OVERALL Median:':<40} {g_med_med:>13} {g_med_max:>13}")
  print(f"{'OVERALL Maximum:':<40} {g_max_med:>13} {g_max_max:>13}")
  print(f"{'OVERALL Sum:':<40} {g_sum_med:>13} {g_sum_max:>13}")
  print("=" * table_width)


def main() -> None:
  if len(sys.argv) < 2 or sys.argv[1] in ("--help", "-h"):
    print("Usage: python3 measure_memory.py <engine_path> "
          "[engine_flags...] [cli_js_args...]")
    print("\nOptions:")
    print("  --combined, --no-split  "
          "Run the complete suite as a single measurement")
    return

  engine_path = Path(sys.argv[1]).expanduser()
  if not engine_path.exists():
    return print(f"Engine not found: {engine_path}")

  engine_type = detect_engine(engine_path)

  base_engine_flags = ["--trace-gc"] if engine_type == Engine.V8 else []

  user_engine_flags = []
  cli_js_args = []
  run_combined = False

  # Known exact or prefix matches for cli.js
  for arg in sys.argv[2:]:
    if arg in ("--no-split", "--combined"):
      run_combined = True
      continue
    if arg.startswith("--") and not any(
        arg.startswith(prefix) for prefix in JS_FLAG_PREFIXES):
      user_engine_flags.append(arg)
    elif arg.startswith("-") and not arg.startswith("--"):
      # Single dash flags usually belong to engines
      user_engine_flags.append(arg)
    else:
      cli_js_args.append(arg)

  engine_flags = base_engine_flags + user_engine_flags

  if run_combined:
    tests = ["JetStream3 (Combined)"]
  else:
    try:
      raw_lines = get_test_list(engine_path, engine_type, cli_js_args)
    except Exception as e:
      return print(f"Error getting test list: {e}")

    tests = [
        t.strip() for t in raw_lines
        if t.strip() and not any(p in t for p in IGNORED_TEST_PATTERNS)
    ]

    if not tests:
      return print(f"No tests found matching: {' '.join(cli_js_args)}")

  print(f"Found {len(tests)} tests.")
  print(f"Engine: {engine_path} {shlex.join(engine_flags)}")
  print(f"CLI args: {shlex.join(cli_js_args)}\n")
  print(
      f"{'Test Name':<33} {'Median':>12} MB ⌀ | {'Peak':>4} MB ▲ | {'History':^10}"
  )
  print("-" * 80)

  results = {}
  try:
    for test in tests:
      median, max_rss = measure_test(engine_path,
                                     engine_type,
                                     test,
                                     engine_flags,
                                     cli_js_args,
                                     combined=run_combined)
      if max_rss:
        results[test] = (median, max_rss)
  except KeyboardInterrupt:
    print("\nInterrupted.")

  print_summary(results, engine_path)


if __name__ == "__main__":
  main()
