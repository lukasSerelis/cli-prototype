import { FitAddon } from "@xterm/addon-fit"
import { Terminal as XTerminal } from "xterm"
import LocalEchoController from "./io/LocalEchoController.js"
import inputHandler from "./io/inputHandler.js"
import initializeYargs from "./io/yargs/initializeYargs.js"
import monkeyPatchStdout from "./shims/monkeyPatchStdout.js"

export class Terminal {
    constructor(element, commands = {}) {
        this.term = new XTerminal({
            cursorBlink: true,
            convertEol: true,
            fontSize: 16,
            fontFamily: '"Ubuntu Mono", monospace',
            fontWeight: "100",
            fontWeightBold: "bold",
            rendererType: 'canvas', // Explicitly set canvas renderer
            theme: {
                background: "#330F25",
                foreground: "#ffffff",
                cursor: "#ffffff",
                selection: "rgba(255, 255, 255, 0.3)",
                black: "#2e3436",
                red: "#cc0000",
                green: "#00975F",
                yellow: "#c4a000",
                blue: "#00407D",
                magenta: "#75507b",
                cyan: "#06989a",
                white: "#ffffff",
            },
        })

        this.fitAddon = new FitAddon()
        this.localEcho = new LocalEchoController()

        this.term.loadAddon(this.fitAddon)
        this.term.loadAddon(this.localEcho)

        this.init(element, commands)
    }

    init(element, commands) {
        this.term.open(element)

        if (commands.welcome) {
            this.term.write(commands.welcome + "\n\n")
        }

        // Improve resize handling with debounce
        this.fitAddon.fit()
        
        let resizeTimer;
        this.resizeHandler = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                this.fitAddon.fit();
            }, 100);
        }
        
        window.addEventListener("resize", this.resizeHandler)

        monkeyPatchStdout()

        // Optimize the LocalEchoController to reduce flickering
        this.optimizeLocalEcho();

        const yargs = initializeYargs(this.localEcho, commands)
        inputHandler(this.localEcho, this.term, yargs)
        this.term.focus()
    }

    // Add a method to optimize LocalEchoController and fix flickering
    optimizeLocalEcho() {
        // Only if the LocalEchoController has the required methods
        if (this.localEcho && this.localEcho.updatePromptLine) {
            // Store the original method
            const originalUpdatePromptLine = this.localEcho.updatePromptLine;
            
            // Override with optimized version
            this.localEcho.updatePromptLine = function(newPrompt) {
                // Skip redundant updates that cause flickering
                if (this._active && this._active.input === newPrompt) {
                    return;
                }
                
                // If no active session, just call the original method
                if (!this._active) {
                    return originalUpdatePromptLine.call(this, newPrompt);
                }
                
                // Get current cursor position and prompt text
                const currentInput = this._active.input;
                const currentCursor = this._active.cursorPos;
                const promptText = this._active.prompt;
                
                // Determine if we need to redraw
                if (currentInput !== newPrompt) {
                    // Calculate new cursor position
                    const newCursor = Math.min(currentCursor, newPrompt.length);
                    
                    // Clear current line and write in one operation
                    this.term.write('\r\x1B[K' + promptText + newPrompt);
                    
                    // Position cursor correctly
                    const totalLength = promptText.length + newPrompt.length;
                    const targetPos = promptText.length + newCursor;
                    
                    if (targetPos < totalLength) {
                        this.term.write('\b'.repeat(totalLength - targetPos));
                    }
                    
                    // Update state
                    this._active.input = newPrompt;
                    this._active.cursorPos = newCursor;
                }
            };
            
            // Also optimize the line redrawing function if available
            if (this.localEcho._pushToStdout) {
                const originalPushToStdout = this.localEcho._pushToStdout;
                this.localEcho._pushToStdout = function(text) {
                    // Use original but don't do redundant redraws
                    originalPushToStdout.call(this, text);
                };
            }
            
            // Add direct utility methods to the window.t object
            window.t = {
                print: (text) => {
                    this.localEcho.print(text);
                },
                println: (text) => {
                    this.localEcho.println(text);
                },
                write: (text) => {
                    this.localEcho.print(text);
                },
                clear: () => {
                    this.term.write('\x1b[2J\x1b[H');
                    this.localEcho.println('');
                }
            };
        }
    }

    destroy() {
        window.removeEventListener("resize", this.resizeHandler)
        this.term.dispose()
    }
}
