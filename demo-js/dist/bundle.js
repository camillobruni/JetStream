(() => {
    "use strict";
    const __webpack_require__ = {};
    __webpack_require__.d = (exports, definition) => {
        for (var key in definition) {
            if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
                Object.defineProperty(exports, key, {
                    enumerable: true,
                    get: definition[key]
                });
            }
        }
    };
    __webpack_require__.o = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
    __webpack_require__.r = exports => {
        Object.defineProperty(exports, Symbol.toStringTag, {
            value: "Module"
        });
        Object.defineProperty(exports, "__esModule", {
            value: true
        });
    };
    let __webpack_exports__ = {};
    __webpack_require__.r(__webpack_exports__);
    __webpack_require__.d(__webpack_exports__, {
        countWords: () => countWords,
        normalize: () => normalize
    });
    function normalize(words) {
        return words.map(word => word.toUpperCase()).join(" ");
    }
    function countWords(text) {
        const counts = new Map;
        for (const word of text.split(" ")) counts.set(word, (counts.get(word) ?? 0) + 1);
        return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    }
    globalThis.DemoJS = __webpack_exports__;
})();