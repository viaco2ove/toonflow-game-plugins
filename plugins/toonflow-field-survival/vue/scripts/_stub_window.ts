/** 测试专用：在导入 src 模块前垫一个最小 window 全局（toonflowJsApi 顶层引用 window） */
// @ts-nocheck
if (typeof (globalThis as any).window === "undefined") {
  (globalThis as any).window = {
    location: { href: "http://localhost:3000/", origin: "http://localhost:3000" },
    addEventListener: () => {},
    removeEventListener: () => {},
    postMessage: () => {},
    parent: { postMessage: () => {} },
  };
}
if (typeof (globalThis as any).document === "undefined") {
  (globalThis as any).document = { createElement: () => ({ style: {} }), addEventListener: () => {} };
}
export {};
