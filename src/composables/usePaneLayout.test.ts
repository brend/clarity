// @vitest-environment jsdom
import { defineComponent, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePaneLayout } from "./usePaneLayout";

function setElementSize(element: HTMLElement, size: { width?: number; height?: number }) {
  if (typeof size.width === "number") {
    Object.defineProperty(element, "clientWidth", {
      configurable: true,
      value: size.width,
    });
  }

  if (typeof size.height === "number") {
    Object.defineProperty(element, "clientHeight", {
      configurable: true,
      value: size.height,
    });
  }
}

describe("usePaneLayout", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
      writable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
      writable: true,
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    document.body.removeAttribute("style");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies initial bounded layout styles on mount", async () => {
    const Harness = defineComponent({
      setup() {
        const desktopShellEl = ref<HTMLElement | null>(null);
        const workspaceEl = ref<HTMLElement | null>(null);
        return {
          desktopShellEl,
          workspaceEl,
          ...usePaneLayout({ desktopShellEl, workspaceEl }),
        };
      },
      template: `
        <div ref="desktopShellEl">
          <div ref="workspaceEl"></div>
        </div>
      `,
    });

    const wrapper = mount(Harness);
    setElementSize(wrapper.vm.desktopShellEl as HTMLElement, { width: 1200 });
    setElementSize(wrapper.vm.workspaceEl as HTMLElement, { height: 900 });
    window.dispatchEvent(new Event("resize"));
    await nextTick();

    expect(wrapper.vm.desktopShellStyle["--sidebar-width"]).toBe("300px");
    expect(wrapper.vm.workspaceStyle["--results-height"]).toBe("270px");
  });

  it("clamps sidebar resizing to the maximum allowed width", async () => {
    const Harness = defineComponent({
      setup() {
        const desktopShellEl = ref<HTMLElement | null>(null);
        const workspaceEl = ref<HTMLElement | null>(null);
        return {
          desktopShellEl,
          workspaceEl,
          ...usePaneLayout({ desktopShellEl, workspaceEl }),
        };
      },
      template: `
        <div ref="desktopShellEl">
          <div ref="workspaceEl"></div>
        </div>
      `,
    });

    const wrapper = mount(Harness);
    setElementSize(wrapper.vm.desktopShellEl as HTMLElement, { width: 1200 });
    setElementSize(wrapper.vm.workspaceEl as HTMLElement, { height: 900 });
    window.dispatchEvent(new Event("resize"));
    await nextTick();

    wrapper.vm.beginSidebarResize(
      new MouseEvent("pointerdown", { clientX: 100 }) as unknown as PointerEvent,
    );
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 900 }));
    await nextTick();

    expect(wrapper.vm.desktopShellStyle["--sidebar-width"]).toBe("634px");
    expect(document.body.style.cursor).toBe("col-resize");

    window.dispatchEvent(new MouseEvent("pointerup"));
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("skips sidebar resizing on mobile breakpoints", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: true,
        media: "(max-width: 980px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    const Harness = defineComponent({
      setup() {
        const desktopShellEl = ref<HTMLElement | null>(null);
        const workspaceEl = ref<HTMLElement | null>(null);
        return {
          desktopShellEl,
          workspaceEl,
          ...usePaneLayout({ desktopShellEl, workspaceEl }),
        };
      },
      template: `
        <div ref="desktopShellEl">
          <div ref="workspaceEl"></div>
        </div>
      `,
    });

    const wrapper = mount(Harness);
    setElementSize(wrapper.vm.desktopShellEl as HTMLElement, { width: 1200 });
    setElementSize(wrapper.vm.workspaceEl as HTMLElement, { height: 900 });
    window.dispatchEvent(new Event("resize"));
    await nextTick();

    wrapper.vm.beginSidebarResize(
      new MouseEvent("pointerdown", { clientX: 100 }) as unknown as PointerEvent,
    );
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 700 }));
    await nextTick();

    expect(wrapper.vm.desktopShellStyle["--sidebar-width"]).toBe("300px");
    expect(document.body.style.cursor).toBe("");
  });

  it("resizes results pane within min and max bounds", async () => {
    const Harness = defineComponent({
      setup() {
        const desktopShellEl = ref<HTMLElement | null>(null);
        const workspaceEl = ref<HTMLElement | null>(null);
        return {
          desktopShellEl,
          workspaceEl,
          ...usePaneLayout({ desktopShellEl, workspaceEl }),
        };
      },
      template: `
        <div ref="desktopShellEl">
          <div ref="workspaceEl"></div>
        </div>
      `,
    });

    const wrapper = mount(Harness);
    setElementSize(wrapper.vm.desktopShellEl as HTMLElement, { width: 1200 });
    setElementSize(wrapper.vm.workspaceEl as HTMLElement, { height: 900 });
    window.dispatchEvent(new Event("resize"));
    await nextTick();

    wrapper.vm.beginResultsResize(
      new MouseEvent("pointerdown", { clientY: 500 }) as unknown as PointerEvent,
    );
    expect(document.body.style.cursor).toBe("row-resize");
    expect(document.body.style.userSelect).toBe("none");

    window.dispatchEvent(new MouseEvent("pointermove", { clientY: 900 }));
    await nextTick();
    expect(wrapper.vm.workspaceStyle["--results-height"]).toBe("170px");

    window.dispatchEvent(new MouseEvent("pointermove", { clientY: 100 }));
    await nextTick();
    expect(wrapper.vm.workspaceStyle["--results-height"]).toBe("574px");

    window.dispatchEvent(new MouseEvent("pointercancel"));
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("clears resize state on component unmount", async () => {
    const Harness = defineComponent({
      setup() {
        const desktopShellEl = ref<HTMLElement | null>(null);
        const workspaceEl = ref<HTMLElement | null>(null);
        return {
          desktopShellEl,
          workspaceEl,
          ...usePaneLayout({ desktopShellEl, workspaceEl }),
        };
      },
      template: `
        <div ref="desktopShellEl">
          <div ref="workspaceEl"></div>
        </div>
      `,
    });

    const wrapper = mount(Harness);
    setElementSize(wrapper.vm.desktopShellEl as HTMLElement, { width: 1200 });
    setElementSize(wrapper.vm.workspaceEl as HTMLElement, { height: 900 });
    await nextTick();

    wrapper.vm.beginResultsResize(
      new MouseEvent("pointerdown", { clientY: 500 }) as unknown as PointerEvent,
    );
    expect(document.body.style.cursor).toBe("row-resize");

    wrapper.unmount();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("re-applies bounds from current results height after manual resize", async () => {
    const Harness = defineComponent({
      setup() {
        const desktopShellEl = ref<HTMLElement | null>(null);
        const workspaceEl = ref<HTMLElement | null>(null);
        return {
          desktopShellEl,
          workspaceEl,
          ...usePaneLayout({ desktopShellEl, workspaceEl }),
        };
      },
      template: `
        <div ref="desktopShellEl">
          <div ref="workspaceEl"></div>
        </div>
      `,
    });

    const wrapper = mount(Harness);
    setElementSize(wrapper.vm.desktopShellEl as HTMLElement, { width: 1200 });
    setElementSize(wrapper.vm.workspaceEl as HTMLElement, { height: 900 });
    window.dispatchEvent(new Event("resize"));
    await nextTick();

    wrapper.vm.beginResultsResize(
      new MouseEvent("pointerdown", { clientY: 500 }) as unknown as PointerEvent,
    );
    window.dispatchEvent(new MouseEvent("pointermove", { clientY: 900 }));
    await nextTick();
    expect(wrapper.vm.workspaceStyle["--results-height"]).toBe("170px");

    window.dispatchEvent(new Event("resize"));
    await nextTick();
    expect(wrapper.vm.workspaceStyle["--results-height"]).toBe("170px");
  });

  it("ignores pointermove when no resize is active", async () => {
    const Harness = defineComponent({
      setup() {
        const desktopShellEl = ref<HTMLElement | null>(null);
        const workspaceEl = ref<HTMLElement | null>(null);
        return {
          desktopShellEl,
          workspaceEl,
          ...usePaneLayout({ desktopShellEl, workspaceEl }),
        };
      },
      template: `
        <div ref="desktopShellEl">
          <div ref="workspaceEl"></div>
        </div>
      `,
    });

    const wrapper = mount(Harness);
    setElementSize(wrapper.vm.desktopShellEl as HTMLElement, { width: 1200 });
    setElementSize(wrapper.vm.workspaceEl as HTMLElement, { height: 900 });
    window.dispatchEvent(new Event("resize"));
    await nextTick();

    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 999, clientY: 999 }));
    await nextTick();

    expect(wrapper.vm.desktopShellStyle["--sidebar-width"]).toBe("300px");
    expect(wrapper.vm.workspaceStyle["--results-height"]).toBe("270px");
  });

  it("uses window and default fallbacks when layout element refs are unavailable", async () => {
    const Harness = defineComponent({
      setup() {
        const desktopShellEl = ref<HTMLElement | null>(null);
        const workspaceEl = ref<HTMLElement | null>(null);
        return {
          desktopShellEl,
          workspaceEl,
          ...usePaneLayout({ desktopShellEl, workspaceEl }),
        };
      },
      template: `<div></div>`,
    });

    const wrapper = mount(Harness);
    await nextTick();

    expect(wrapper.vm.desktopShellStyle["--sidebar-width"]).toBe("350px");
    expect(wrapper.vm.workspaceStyle["--results-height"]).toBe("250px");
  });
});
