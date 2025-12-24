## 📑 Dotfiles Management Guide

This guide provides instructions for managing your system configuration files (dotfiles) using the `stow` utility and helper scripts.

Your dotfiles repository structure is assumed to be flat, with each application's configuration directory placed directly under the repository root (e.g., `$HOME/dotfiles/hyprland`, `$HOME/dotfiles/kitty`).

### Prerequisites

Ensure you have the following installed:

  * **`stow`**: A package manager for creating and managing symbolic links.
  * **Bash** and standard core utilities (`mv`, `mkdir`, etc.).
  * The helper scripts (`configure.sh` and `clean.sh`) must be located in the root of this repository and made executable (`chmod +x *.sh`).

-----

### 1\. Repository Structure Overview

The scripts rely on this basic relationship:

| Source Directory (in `$HOME/dotfiles`) | Target Directory (System Config) |
| :--- | :--- |
| `backgrounds` | `$HOME/.config/backgrounds` |
| `hyprland` | `$HOME/.config/hyprland` |
| `kitty` | `$HOME/.config/kitty` |
| ... (and so on) | ... |

-----

### 2\. Deployment: Running `configure.sh`

The `configure.sh` script handles the initial setup:

1.  **Backup**: Moves existing configurations in the repository to a `.bak` extension.
2.  **Preparation**: Creates the necessary target directories under `$HOME/.config/`.
3.  **Stow**: Runs `stow` to create symbolic links from the source directories to the target directories.

#### **Command**

Run the script from your dotfiles directory:

```bash
cd $HOME/dotfiles
./configure.sh
cp -r hyprland/scripts ~/.config/hypr
```

-----

### 3\. Cleanup: Running `clean.sh`

The `clean.sh` script handles the safe removal of the deployed configurations:

1.  **Destow**: Runs `stow -D` to safely remove the symbolic links.
2.  **Restore**: Restores the backed-up directories (ending in `.bak`) to their original names.

#### **Command**

Run the script from your dotfiles directory:

```bash
cd $HOME/dotfiles
./clean.sh
```

-----

### Appendix: Script Contents

For reference, the packages managed by these scripts are: `backgrounds`, `hyprland`, `kitty`, `nvim`, `rofi`, `swaync`, `waybar`, and `wlogout`.