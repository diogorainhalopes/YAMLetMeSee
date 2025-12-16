import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('YAMLetMeSee extension is now active!');

    // Store decorations by column to reuse them (prevents flickering)
    const inactiveDecorationsByCol = new Map<number, vscode.TextEditorDecorationType>();
    const activeDecorationsByCol = new Map<number, vscode.TextEditorDecorationType>();
    let lastColorsHash = '';
    let activeEditor: vscode.TextEditor | undefined;
    let updateTimeout: NodeJS.Timeout | undefined;

    /**
     * Gets the effective indentation column for a line, accounting for YAML list items.
     * For list items like "    - item", returns the column of the spaces before the '-',
     * not the position of the '-' itself.
     */
    function getEffectiveIndentColumn(line: string): number {
        let indent = 0;
        for (let i = 0; i < line.length; i++) {
            if (line[i] === ' ') {
                indent++;
            } else if (line[i] === '\t') {
                indent += 4;
            } else if (line[i] === '-' && i + 1 < line.length && line[i + 1] === ' ') {
                // This is a YAML list item - the indentation is the spaces before the '-'
                break;
            } else {
                break;
            }
        }
        return indent;
    }

    /**
     * Gets the indentation level (0-based) for a line, accounting for YAML list items.
     */
    function getIndentationLevel(line: string): number {
        const effectiveIndent = getEffectiveIndentColumn(line);
        return Math.floor(effectiveIndent / 2);
    }

    function getIndentationColumn(level: number): number {
        return level * 2;
    }

    function hasNestedContent(document: vscode.TextDocument, lineNumber: number): boolean {
        if (lineNumber >= document.lineCount - 1) return false;

        const currentLine = document.lineAt(lineNumber);
        if (currentLine.text.trim().length === 0) return false;

        const currentIndent = getEffectiveIndentColumn(currentLine.text);

        for (let i = lineNumber + 1; i < document.lineCount; i++) {
            const nextLine = document.lineAt(i);
            if (nextLine.text.trim().length === 0) continue;
            const nextIndent = getEffectiveIndentColumn(nextLine.text);
            if (nextIndent > currentIndent) return true;
            if (nextIndent <= currentIndent) return false;
        }
        return false;
    }

    /**
     * Gets the actual parent column for a line by looking backwards for the nearest line
     * with less indentation. Returns -1 if no parent is found (root level).
     */
    function getParentColumn(document: vscode.TextDocument, lineNumber: number): number {
        if (lineNumber <= 0) return -1;

        const currentLine = document.lineAt(lineNumber);
        const currentIndent = getEffectiveIndentColumn(currentLine.text);

        if (currentIndent === 0) return -1;

        for (let i = lineNumber - 1; i >= 0; i--) {
            const prevLine = document.lineAt(i);
            if (prevLine.text.trim().length === 0) continue;
            const prevIndent = getEffectiveIndentColumn(prevLine.text);
            if (prevIndent < currentIndent) {
                return prevIndent;
            }
        }
        return -1;
    }

    function getParentIndentationLevel(document: vscode.TextDocument, lineNumber: number): number {
        const parentCol = getParentColumn(document, lineNumber);
        if (parentCol < 0) return -1;
        return Math.floor(parentCol / 2);
    }

    function hexToRgba(hex: string, alpha: number): string {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function createDecorationType(color: string, isActive: boolean, activeOpacity: number, inactiveOpacity: number): vscode.TextEditorDecorationType {
        const alpha = isActive ? activeOpacity : inactiveOpacity;
        const rgbaColor = color.startsWith('#') ? hexToRgba(color, alpha) : color;
        return vscode.window.createTextEditorDecorationType({
            backgroundColor: rgbaColor
        });
    }

    function disposeAllDecorations() {
        inactiveDecorationsByCol.forEach(d => d.dispose());
        inactiveDecorationsByCol.clear();
        activeDecorationsByCol.forEach(d => d.dispose());
        activeDecorationsByCol.clear();
    }

    function clearAllDecorations() {
        if (!activeEditor) return;
        inactiveDecorationsByCol.forEach(d => activeEditor!.setDecorations(d, []));
        activeDecorationsByCol.forEach(d => activeEditor!.setDecorations(d, []));
    }

    function updateDecorations() {
        if (!activeEditor) return;

        const config = vscode.workspace.getConfiguration('yamletmesee');
        const enabled = config.get<boolean>('enabled', true);

        if (!enabled) {
            clearAllDecorations();
            return;
        }

        const document = activeEditor.document;
        if (document.languageId !== 'yaml') {
            clearAllDecorations();
            return;
        }

        const currentCursorLine = activeEditor.selection.active.line;
        const colors = config.get<string[]>('indentationColors', [
            '#ff0000', '#ff8000', '#ffff00', '#00ff00', '#0080ff', '#8000ff'
        ]);
        const inactiveOpacity = config.get<number>('inactiveOpacity', 0.08);
        const activeOpacity = config.get<number>('activeOpacity', 0.4);
        const spacesPerIndent = config.get<number>('spacesPerIndent', 1);

        // Only recreate decoration types if colors or opacity changed
        const configHash = JSON.stringify({ colors, inactiveOpacity, activeOpacity, spacesPerIndent });
        if (configHash !== lastColorsHash) {
            disposeAllDecorations();
            lastColorsHash = configHash;
        }

        // Find all unique indentation columns that are actual parent levels
        // For each line, we show guides at its parent column and all ancestor columns (recursively)
        const indentColumns = new Set<number>();
        const processedLines = new Set<number>();
        
        const addAncestorColumns = (lineNum: number) => {
            if (processedLines.has(lineNum)) return;
            processedLines.add(lineNum);
            
            const parentCol = getParentColumn(document, lineNum);
            if (parentCol >= 0) {
                indentColumns.add(parentCol);
                // Find the line that has this parent column as its effective indent
                for (let j = lineNum - 1; j >= 0; j--) {
                    const checkLine = document.lineAt(j);
                    if (checkLine.text.trim().length === 0) continue;
                    const checkIndent = getEffectiveIndentColumn(checkLine.text);
                    if (checkIndent === parentCol) {
                        // Recursively add ancestors of this parent line
                        addAncestorColumns(j);
                        break;
                    }
                }
            }
        };
        
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            if (line.text.trim().length === 0) continue;
            addAncestorColumns(i);
        }
        
        // Always include column 0 (root level)
        indentColumns.add(0);

        // Build ranges for each column
        // For each column, we only show guides from parent lines down to the end of their blocks
        const columnRanges = new Map<number, vscode.Range[]>();
        const sortedCols = Array.from(indentColumns).sort((a, b) => a - b);

        for (const col of sortedCols) {
            const ranges: vscode.Range[] = [];

            // Find all parent lines that have this column as their effective indent
            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i);
                const lineText = line.text;
                if (lineText.trim().length === 0) continue;

                const effectiveIndent = getEffectiveIndentColumn(lineText);
                
                // Check if this line is a parent at this column level
                if (effectiveIndent === col) {
                    // This is a parent line - find all its children
                    // The block ends when we encounter a line at the same or higher level
                    let blockEnd = i;
                    for (let j = i + 1; j < document.lineCount; j++) {
                        const childLine = document.lineAt(j);
                        const childText = childLine.text;
                        if (childText.trim().length === 0) {
                            // Empty lines continue the block
                            blockEnd = j;
                            continue;
                        }
                        
                        const childIndent = getEffectiveIndentColumn(childText);
                        
                        // If this line is at the same or higher level, we've reached the end of the block
                        if (childIndent <= col) {
                            break;
                        }
                        
                        // This line is a child (deeper indentation) - it's part of the block
                        blockEnd = j;
                    }
                    
                    // Add ranges from first child to end of block (skip the parent line itself)
                    // The parent line's content starts at col, so we don't want to overlap it
                    for (let k = i + 1; k <= blockEnd; k++) {
                        ranges.push(new vscode.Range(k, col, k, col + spacesPerIndent));
                    }
                }
            }

            if (ranges.length > 0) {
                columnRanges.set(col, ranges);
            }
        }

        // Determine active column and block boundaries
        let activeIndentColumn = -1;
        let activeBlockStart = -1;
        let activeBlockEnd = -1;

        if (currentCursorLine >= 0 && currentCursorLine < document.lineCount) {
            const cursorLine = document.lineAt(currentCursorLine);
            if (cursorLine.text.trim().length > 0) {
                const currentLineLevel = getIndentationLevel(cursorLine.text);
                const isParentLine = hasNestedContent(document, currentCursorLine);

                if (isParentLine) {
                    activeIndentColumn = getIndentationColumn(currentLineLevel);
                } else {
                    const parentLevel = getParentIndentationLevel(document, currentCursorLine);
                    if (parentLevel >= 0) {
                        activeIndentColumn = getIndentationColumn(parentLevel);
                    }
                }

                if (activeIndentColumn >= 0) {
                    if (isParentLine) {
                        activeBlockStart = currentCursorLine + 1;
                        activeBlockEnd = currentCursorLine;
                        for (let i = currentCursorLine + 1; i < document.lineCount; i++) {
                            const line = document.lineAt(i);
                            if (line.text.trim().length === 0) continue;
                            if (getEffectiveIndentColumn(line.text) > activeIndentColumn) {
                                activeBlockEnd = i;
                            } else break;
                        }
                    } else {
                        activeBlockStart = activeBlockEnd = currentCursorLine;
                        for (let i = currentCursorLine - 1; i >= 0; i--) {
                            const line = document.lineAt(i);
                            if (line.text.trim().length === 0) continue;
                            if (getEffectiveIndentColumn(line.text) > activeIndentColumn) {
                                activeBlockStart = i;
                            } else break;
                        }
                        for (let i = currentCursorLine + 1; i < document.lineCount; i++) {
                            const line = document.lineAt(i);
                            if (line.text.trim().length === 0) continue;
                            if (getEffectiveIndentColumn(line.text) > activeIndentColumn) {
                                activeBlockEnd = i;
                            } else break;
                        }
                    }
                }
            }
        }

        // Apply decorations - reuse existing decoration types
        const sortedColumns = Array.from(columnRanges.keys()).sort((a, b) => a - b);

        sortedColumns.forEach(col => {
            const colorIndex = (col / 2) % colors.length;
            const color = colors[colorIndex];

            // Get or create inactive decoration for this column
            if (!inactiveDecorationsByCol.has(col)) {
                inactiveDecorationsByCol.set(col, createDecorationType(color, false, activeOpacity, inactiveOpacity));
            }
            // Get or create active decoration for this column
            if (!activeDecorationsByCol.has(col)) {
                activeDecorationsByCol.set(col, createDecorationType(color, true, activeOpacity, inactiveOpacity));
            }

            const inactiveDecoration = inactiveDecorationsByCol.get(col)!;
            const activeDecoration = activeDecorationsByCol.get(col)!;
            const ranges = columnRanges.get(col)!;

            const inactiveRanges: vscode.Range[] = [];
            const activeRanges: vscode.Range[] = [];

            ranges.forEach(range => {
                const lineNum = range.start.line;
                if (col === activeIndentColumn && lineNum >= activeBlockStart && lineNum <= activeBlockEnd) {
                    activeRanges.push(range);
                } else {
                    inactiveRanges.push(range);
                }
            });

            activeEditor!.setDecorations(inactiveDecoration, inactiveRanges);
            activeEditor!.setDecorations(activeDecoration, activeRanges);
        });

        // Clear decorations for columns that no longer have ranges
        inactiveDecorationsByCol.forEach((decoration, col) => {
            if (!columnRanges.has(col)) {
                activeEditor!.setDecorations(decoration, []);
            }
        });
        activeDecorationsByCol.forEach((decoration, col) => {
            if (!columnRanges.has(col)) {
                activeEditor!.setDecorations(decoration, []);
            }
        });
    }

    function triggerUpdateDecorations() {
        // Debounce updates to prevent flickering
        if (updateTimeout) {
            clearTimeout(updateTimeout);
        }
        updateTimeout = setTimeout(updateDecorations, 10);
    }

    // Initialize
    if (vscode.window.activeTextEditor) {
        activeEditor = vscode.window.activeTextEditor;
        updateDecorations();
    }

    // Event listeners
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            activeEditor = editor;
            if (editor) updateDecorations();
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (activeEditor?.document === event.document) {
                triggerUpdateDecorations();
            }
        }),
        vscode.window.onDidChangeTextEditorSelection(event => {
            if (event.textEditor === activeEditor) {
                triggerUpdateDecorations();
            }
        }),
        vscode.workspace.onDidChangeConfiguration(() => {
            lastColorsHash = ''; // Force recreation of decorations
            triggerUpdateDecorations();
        }),
        { dispose: () => disposeAllDecorations() }
    );
}

export function deactivate() {}
