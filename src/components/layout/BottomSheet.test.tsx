/* @vitest-environment jsdom */
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import BottomSheet from "./BottomSheet";

// Mock history.pushState so it doesn't affect jsdom's location.
const pushStateSpy = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
const replaceStateSpy = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});

describe("BottomSheet — hardware-back / LIFO close stack", () => {
  beforeEach(() => {
    pushStateSpy.mockClear();
    replaceStateSpy.mockClear();
  });

  it("pushes a history entry when isOpen becomes true", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <BottomSheet isOpen onClose={onClose}>
        content
      </BottomSheet>,
    );
    expect(pushStateSpy).toHaveBeenCalledOnce();
    unmount();
  });

  it("calls onClose when popstate fires while open", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <BottomSheet isOpen onClose={onClose}>
        content
      </BottomSheet>,
    );
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
  });

  it("closes the topmost sheet first — LIFO ordering", () => {
    const onClose1 = vi.fn();
    const onClose2 = vi.fn();
    const { unmount: u1 } = render(
      <BottomSheet isOpen onClose={onClose1}>
        sheet 1
      </BottomSheet>,
    );
    const { unmount: u2 } = render(
      <BottomSheet isOpen onClose={onClose2}>
        sheet 2
      </BottomSheet>,
    );

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(onClose2).toHaveBeenCalledOnce();
    expect(onClose1).not.toHaveBeenCalled();

    u2();
    u1();
  });

  it("intercepts hardware-back when onInterceptClose returns true", () => {
    const onClose = vi.fn();
    const onInterceptClose = vi.fn().mockReturnValue(true);
    const { unmount } = render(
      <BottomSheet isOpen onClose={onClose} onInterceptClose={onInterceptClose}>
        content
      </BottomSheet>,
    );

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(onInterceptClose).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    // Re-push so the next back press still finds the sheet's entry
    expect(pushStateSpy).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("calls onClose on second back after intercept clears", () => {
    const onClose = vi.fn();
    // First back: intercept (numpad open). Second back: close sheet.
    let numpadOpen = true;
    const onInterceptClose = vi.fn().mockImplementation(() => {
      if (numpadOpen) {
        numpadOpen = false;
        return true;
      }
      return false;
    });

    const { unmount } = render(
      <BottomSheet isOpen onClose={onClose} onInterceptClose={onInterceptClose}>
        content
      </BottomSheet>,
    );

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate")); // first back — intercept
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate")); // second back — close
    });
    expect(onClose).toHaveBeenCalledOnce();

    unmount();
  });

  it("does not trigger onClose when programmatic close removes the entry", () => {
    const onClose = vi.fn();
    const { rerender, unmount } = render(
      <BottomSheet isOpen onClose={onClose}>
        content
      </BottomSheet>,
    );

    // Simulate parent setting isOpen=false (button/save close)
    act(() => {
      rerender(
        <BottomSheet isOpen={false} onClose={onClose}>
          content
        </BottomSheet>,
      );
    });

    // Cleanup calls history.replaceState() to neutralise the pushed entry
    // in-place — no popstate fires, so onClose is not called a second time.
    expect(replaceStateSpy).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    unmount();
  });

  it("uses onBackdropClick instead of onClose when backdrop is tapped", () => {
    const onClose = vi.fn();
    const onBackdropClick = vi.fn();
    render(
      <BottomSheet isOpen onClose={onClose} onBackdropClick={onBackdropClick}>
        content
      </BottomSheet>,
    );

    const backdrop = document.body.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(backdrop).not.toBeNull();

    act(() => {
      backdrop.click();
    });

    expect(onBackdropClick).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("falls back to onClose for backdrop tap when onBackdropClick is not provided", () => {
    const onClose = vi.fn();
    render(
      <BottomSheet isOpen onClose={onClose}>
        content
      </BottomSheet>,
    );

    const backdrop = document.body.querySelector('[aria-hidden="true"]') as HTMLElement;
    act(() => {
      backdrop.click();
    });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
