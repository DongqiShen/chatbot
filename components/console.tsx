import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useArtifactSelector } from "@/hooks/use-artifact";
import { cn } from "@/lib/utils";
import { CrossSmallIcon, TerminalWindowIcon } from "./icons";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

export type ConsoleOutputContent = {
  type: "text" | "image";
  value: string;
};

export type ConsoleOutput = {
  id: string;
  status: "in_progress" | "loading_packages" | "completed" | "failed";
  contents: ConsoleOutputContent[];
};

type ConsoleProps = {
  consoleOutputs: ConsoleOutput[];
  setConsoleOutputs: Dispatch<SetStateAction<ConsoleOutput[]>>;
};

export function Console({ consoleOutputs, setConsoleOutputs }: ConsoleProps) {
  const [height, setHeight] = useState<number>(300);
  const [isResizing, setIsResizing] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);

  const minHeight = 100;
  const maxHeight = 800;

  const startResizing = useCallback(() => {
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (isResizing) {
        const newHeight = window.innerHeight - e.clientY;
        if (newHeight >= minHeight && newHeight <= maxHeight) {
          setHeight(newHeight);
        }
      }
    },
    [isResizing]
  );

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (!isArtifactVisible) {
      setConsoleOutputs([]);
    }
  }, [isArtifactVisible, setConsoleOutputs]);

  return consoleOutputs.length > 0 ? (
    <>
      <div
        aria-label="Resize console"
        aria-orientation="horizontal"
        aria-valuemax={maxHeight}
        aria-valuemin={minHeight}
        aria-valuenow={height}
        className="fixed z-50 h-2 w-full cursor-ns-resize"
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            setHeight((prev) => Math.min(prev + 10, maxHeight));
          } else if (e.key === "ArrowDown") {
            setHeight((prev) => Math.max(prev - 10, minHeight));
          }
        }}
        onMouseDown={startResizing}
        role="slider"
        style={{ bottom: height - 4 }}
        tabIndex={0}
      />

      <div
        className={cn(
          "fixed bottom-0 z-40 flex w-full flex-col overflow-x-hidden overflow-y-scroll border-neutral-200 border-t bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900",
          {
            "select-none": isResizing,
          }
        )}
        style={{ height }}
      >
        <div className="sticky top-0 z-50 flex h-fit w-full flex-row items-center justify-between border-neutral-200 border-b bg-muted px-2 py-1 dark:border-neutral-700">
          <div className="flex flex-row items-center gap-3 pl-2 text-sm text-neutral-800 dark:text-neutral-50">
            <div className="text-muted-foreground">
              <TerminalWindowIcon />
            </div>
            <div>Console</div>
          </div>
          <Button
            className="size-fit p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700"
            onClick={() => setConsoleOutputs([])}
            size="icon"
            variant="ghost"
          >
            <CrossSmallIcon />
          </Button>
        </div>

        <div>
          {consoleOutputs.map((consoleOutput, index) => (
            <div
              className="flex flex-row border-neutral-200 border-b bg-neutral-50 px-4 py-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-900"
              key={consoleOutput.id}
            >
              <div
                className={cn("w-12 shrink-0", {
                  "text-muted-foreground": [
                    "in_progress",
                    "loading_packages",
                  ].includes(consoleOutput.status),
                  "text-emerald-500": consoleOutput.status === "completed",
                  "text-red-400": consoleOutput.status === "failed",
                })}
              >
                [{index + 1}]
              </div>
              {["in_progress", "loading_packages"].includes(
                consoleOutput.status
              ) ? (
                <div className="flex flex-row gap-2">
                  <div className="mt-0.5 mb-auto size-fit self-center">
                    <Spinner className="size-4" />
                  </div>
                  <div className="text-muted-foreground">
                    {consoleOutput.status === "in_progress"
                      ? "Initializing..."
                      : consoleOutput.status === "loading_packages"
                        ? consoleOutput.contents.map((content) =>
                            content.type === "text" ? content.value : null
                          )
                        : null}
                  </div>
                </div>
              ) : (
                <div className="flex w-full flex-col gap-2 overflow-x-scroll text-neutral-900 dark:text-neutral-50">
                  {consoleOutput.contents.map((content) =>
                    content.type === "image" ? (
                      <picture key={`${consoleOutput.id}-${content.value}`}>
                        <img
                          alt="output"
                          className="w-full max-w-(--breakpoint-toast-mobile) rounded-md"
                          src={content.value}
                        />
                      </picture>
                    ) : (
                      <div
                        className="w-full whitespace-pre-line break-words"
                        key={`${consoleOutput.id}-${content.value}`}
                      >
                        {content.value}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={consoleEndRef} />
        </div>
      </div>
    </>
  ) : null;
}
