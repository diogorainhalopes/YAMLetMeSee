# YAMLetMeSee

A Visual Studio Code extension that highlights indentation in YAML files to make it easier to track nested structures.

## Features

- 🎨 **Colored Indentation Guides**: Different colors for different indentation levels
- ✨ **Smart Block Highlighting**: Active block highlights when cursor is on a line
- ⚙️ **Fully Customizable**: Configure colors and opacity for both active and inactive guides
- 🚀 **Real-time Updates**: Updates as you edit and navigate
- 💡 **Lightweight**: Optimized to prevent flickering

## Usage

Simply open a YAML file and the extension will automatically show colored vertical indentation guides. When you place your cursor on a line, the relevant indentation block is highlighted.

## Configuration

The extension provides the following settings:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `yamletmesee.enabled` | boolean | `true` | Enable/disable the extension |
| `yamletmesee.indentationColors` | array | See below | Colors for each indentation level (hex format) |
| `yamletmesee.inactiveOpacity` | number | `0.08` | Opacity for inactive guides (0-1) |
| `yamletmesee.activeOpacity` | number | `0.4` | Opacity for active/highlighted guides (0-1) |

### Default Colors (Rainbow)

```json
["#ff0000", "#ff8000", "#ffff00", "#00ff00", "#0080ff", "#8000ff"]
```
(Red → Orange → Yellow → Green → Blue → Purple)

### Example Configuration

```json
{
  "yamletmesee.enabled": true,
  "yamletmesee.indentationColors": [
    "#00ff00",
    "#ff00ff",
    "#00ffff",
    "#ffff00"
  ],
  "yamletmesee.inactiveOpacity": 0.1,
  "yamletmesee.activeOpacity": 0.5
}
```

## Development

### Prerequisites

- Node.js
- npm or yarn
- Visual Studio Code

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Compile the TypeScript code:
   ```bash
   npm run compile
   ```

3. Press `F5` in VS Code to open a new Extension Development Host window

4. Open a YAML file in the new window to see the extension in action

### Building

```bash
npm run compile
```

### Watch Mode

```bash
npm run watch
```
