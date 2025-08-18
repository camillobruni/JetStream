function shuffleOptions(optionsGenerator) {
  const options = Array.from(optionsGenerator());
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

const LOCALES = [
  "ar-SA",
  "zh-CN",
  "zh-TW",
  "da-DK",
  "en-US",
  "en-GB",
  "en-CA",
  "en-AU",
  "fr-FR",
  "fr-CA",
  "de-DE",
  "hi-IN",
  "it-IT",
  "ja-JP",
  "ko-KR",
  "pt-BR",
  "pt-PT",
  "ru-RU",
  "es-ES",
  "es-MX",
  "sw-KE",
  "sv-SE",
  "th-TH",
  "tr-TR",
  "vi-VN",
];

globalThis.console ??= {};
console.log ??= (...args) => print(...args);

function generateRandomDates(count) {
  const firstDate = new Date(1800, 11, 5, 13, 6);
  let currentTimeStamp = firstDate.getTime();
  const dates = [];

  for (let i = 0; i < count; i++) {
    dates.push(new Date(currentTimeStamp));
    currentTimeStamp += 1234569;
  }
  return dates;
}

const DATE_STYLE_OPTIONS = ["full", "long", "medium", "short"];
const TIME_STYLE_OPTIONS = ["full", "long", "medium", "short"];

function* dateTimeFormatOptions() {
  for (const locale of LOCALES) {
    for (const dateStyle of DATE_STYLE_OPTIONS) {
      for (const timeStyle of TIME_STYLE_OPTIONS) {
        yield { locale, dateStyle, timeStyle };
      }
    }
  }
}

function DateTimeFormatPerformanceTest() {
  let totalLength = 0;
  let lastFormatResult;
  let lastFormatPartResult;
  let lastFormatRangeResult;
  const dates = generateRandomDates(100);
  let dateIndex = 0;

  const FORMAT_COUNT = 17;
  const FORMAT_RANGE_COUNT = 7;
  for (const { locale, dateStyle, timeStyle } of shuffleOptions(
    dateTimeFormatOptions
  )) {
    const formatter = new Intl.DateTimeFormat(locale, { dateStyle, timeStyle });
    for (let i = 0; i < FORMAT_COUNT; i++) {
      let date = dates[dateIndex % dates.length];
      lastFormatResult = formatter.format(date);
      totalLength += lastFormatResult.length;
      dateIndex++;

      date = dates[dateIndex % dates.length];
      lastFormatPartResult = formatter.formatToParts(date);
      for (const part of lastFormatPartResult) {
        totalLength += part.value.length;
      }
      dateIndex++;
    }
    let dateRangeStart = dates[0];
    for (let i = 0; i < FORMAT_RANGE_COUNT; i++) {
      const date = dates[dateIndex % dates.length];
      if (dateRangeStart < date)
        lastFormatRangeResult = formatter.formatRange(dateRangeStart, date);
      dateRangeStart = date;
    }
  }
  return {lastResult: lastFormatResult + lastFormatRangeResult, totalLength};
}

const LISTS = [
  ["One"],
  ["1", "2"],
  ["Motorcycle", "Bus", "Car"],
  LOCALES,
  new Array(100).fill(9).map((_, index) => index.toString()),
];

function* listOptions() {
  const styleOptions = ["long", "short", "narrow"];
  const typeOptions = ["conjunction", "disjunction", "unit"];
  for (const locale of LOCALES) {
    for (const style of styleOptions) {
      for (const type of typeOptions) {
        yield { locale, style, type };
      }
    }
  }
}

function ListFormatPerformanceTest() {
  let lastResult;
  let totalLength = 0;
  const LIST_FORMAT_COUNT = 10;
  let listIndex = 0;
  for (const { locale, style, type } of shuffleOptions(listOptions)) {
    const formatter = new Intl.ListFormat(locale, { style, type });
    for (let i = 0; i < LIST_FORMAT_COUNT; i++) {
      const list = LISTS[listIndex % LISTS.length];
      listIndex++;
      lastResult = formatter.format(list);
      totalLength += lastResult.length;
      const formatPartsResult = formatter.formatToParts(list);
      for (const part of formatPartsResult) {
        totalLength += part.value.length;
      }
    }
  }
  return {lastResult, totalLength};
}

const UNITS = [
  "year",
  "quarter",
  "month",
  "week",
  "day",
  "hour",
  "minute",
  "second",
];

function* relativeTimeFormatOptions() {
  const styleOptions = ["long", "short", "narrow"];
  const numericOptions = ["always", "auto"];
  for (const locale of LOCALES) {
    for (const style of styleOptions) {
      for (const numeric of numericOptions) {
        yield { locale, style, numeric };
      }
    }
  }
}

function RelativeTimeFormatPerformanceTest() {
  let lastResult;
  let totalLength = 0;
  const RELATIVE_TIME_FORMAT_COUNT = 100;
  let unitIndex = 0;
  for (const { locale, style, numeric } of shuffleOptions(
    relativeTimeFormatOptions
  )) {
    const formatter = new Intl.RelativeTimeFormat(locale, { style, numeric });
    for (let i = 0; i < RELATIVE_TIME_FORMAT_COUNT; i++) {
      const unit = UNITS[unitIndex % UNITS.length];
      unitIndex++;
      const value = Math.random() * 100 - 50;
      lastResult = formatter.format(value, unit);
      totalLength += lastResult.length;
      const formatPartsResult = formatter.formatToParts(value, unit);
      for (const part of formatPartsResult) {
        totalLength += part.value.length;
      }
    }
  }
  return {lastResult, totalLength};
}

const CURRENCIES = [
  "USD",
  "EUR",
  "JPY",
  "INR",
  "NGN",
];

const NUMBER_UNITS = [
  "acre",
  "bit",
  "byte",
  "celsius",
  "centimeter",
  "day",
  "degree",
  "fahrenheit",
  "fluid-ounce",
  "foot",
  "gallon",
  "gigabit",
  "gigabyte",
  "gram",
  "hectare",
  "hour",
  "inch",
  "kilobit",
  "kilobyte",
  "kilogram",
  "kilometer",
  "liter",
  "megabit",
  "megabyte",
  "meter",
  "microsecond",
  "mile",
  "mile-scandinavian",
  "milliliter",
  "millimeter",
  "millisecond",
  "minute",
  "month",
  "nanosecond",
  "ounce",
  "percent",
  "petabyte",
  "pound",
  "second",
  "stone",
  "terabit",
  "terabyte",
  "week",
  "yard",
  "year",
];

function* numberFormatOptions() {
  const currencyDisplayOptions = ["symbol", "narrowSymbol", "code", "name"];
  const unitDisplayOptions = ["short", "long", "narrow"];

  for (const locale of LOCALES) {
    for (const currency of CURRENCIES) {
      for (const currencyDisplay of currencyDisplayOptions) {
        yield { locale, style: "currency", currency, currencyDisplay };
      }
    }
    for (const unit of NUMBER_UNITS.slice(0, 20)) {
      for (const unitDisplay of unitDisplayOptions) {
        yield { locale, style: "unit", unit, unitDisplay };
      }
    }
    yield { locale, style: "decimal" };
    yield { locale, style: "percent" };
  }
}

function NumberFormatPerformanceTest() {
  let lastResult;
  let totalLength = 0;
  const NUMBER_FORMAT_COUNT = 10;
  for (const options of shuffleOptions(numberFormatOptions).slice(0, 200)) {
    const formatter = new Intl.NumberFormat(options.locale, options);
    for (let i = 0; i < NUMBER_FORMAT_COUNT; i++) {
      const value = Math.random() * 10_000;
      lastResult = formatter.format(value);
      totalLength += lastResult.length;
      const formatPartsResult = formatter.formatToParts(value);
      for (const part of formatPartsResult) {
        totalLength += part.value.length;
      }
    }
  }
  return {lastResult, totalLength};
}

function* pluralRulesOptions() {
  const typeOptions = ["cardinal", "ordinal"];
  for (const locale of LOCALES) {
    for (const type of typeOptions) {
      yield { locale, type };
    }
  }
}

function PluralRulesPerformanceTest() {
  let lastResult;
  let totalLength = 0;
  const PLURAL_RULES_COUNT = 1000;
  for (const { locale, type } of shuffleOptions(pluralRulesOptions)) {
    const formatter = new Intl.PluralRules(locale, { type });
    let i = 0;
    for (let value = 0; value < 4; value++) {
      lastResult = formatter.select(value);
      totalLength += lastResult.length;
      i++;
    }
    for (; i < PLURAL_RULES_COUNT; i++) {
      const value = Math.floor(Math.random() * 1000);
      lastResult = formatter.select(value);
      totalLength += lastResult.length;
    }
  }
  return {lastResult, totalLength};
}

class Benchmark {
  measureItems = false
  lastResult;
  totalLength = 0;

  runIteration() {
    this.run(DateTimeFormatPerformanceTest);
    this.run(ListFormatPerformanceTest);
    this.run(RelativeTimeFormatPerformanceTest);
    this.run(NumberFormatPerformanceTest);
    this.run(PluralRulesPerformanceTest);
  }

  run(fn) {
    let result;
    if (!this.measureItems) {
      result = fn();
    } else {
      const start = performance.now();
      result = fn();
      const end = performance.now();
      console.log(`    ${fn.name}: ${(end - start).toFixed(2)}ms`);
    }
    const {lastResult, totalLength} = result;
    this.lastResult = lastResult;
    this.totalLength += totalLength;
  }
}
