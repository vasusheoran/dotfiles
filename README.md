## Dotfiles

Personal dotfiles managed with [GNU Stow](https://www.gnu.org/software/stow/).
Supports **macOS**, **Ubuntu/Debian**, and **Arch Linux**.

---

### Quick Start

Run this one-liner to clone the repo and run the full setup (installs tools + deploys configs):

**curl:**
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/vasusheoran/dotfiles/feature/stow/configure.sh)"
```

**wget:**
```bash
bash -c "$(wget -qO- https://raw.githubusercontent.com/vasusheoran/dotfiles/feature/stow/configure.sh)"
```

> This will install all required tools for your OS, set up Oh My Zsh + Powerlevel10k, and symlink all configs via stow.

To skip tool installation and only deploy configs (if tools are already installed):
```bash
git clone git@github.com:vasusheoran/dotfiles.git ~/dotfiles
cd ~/dotfiles && ./configure.sh --no-install
```

---

### What Gets Installed

| Tool | macOS | Ubuntu | Arch |
| :--- | :---: | :---: | :---: |
| zsh, git, stow | ✓ | ✓ | ✓ |
| fzf, zoxide, thefuck | ✓ | ✓ | ✓ |
| tmux, neovim, ripgrep | ✓ | ✓ | ✓ |
| kitty, eza | ✓ | ✓ | ✓ |
| Oh My Zsh + Powerlevel10k | ✓ | ✓ | ✓ |
| Hyprland desktop stack | ✗ | ✗ | ✓ |

---

### Repository Structure

Each top-level directory is a stow package that maps to `~` or `~/.config/`:

| Package | Target | Platforms |
| :--- | :--- | :--- |
| `shell/` | `~/` (.alias, .bashrc, .profile) | All |
| `zsh/` | `~/` (.zshrc, .fzf.zsh) | All |
| `nvim/` | `~/.config/nvim/` | All |
| `tmux/` | `~/` (.tmux.conf) | All |
| `kitty/` | `~/.config/kitty/` | All |
| `hyprland/` | `~/.config/hyprland/` | Arch |
| `hyprpaper/`, `hyprlock/`, `hyprmocha/` | `~/.config/` | Arch |
| `rofi/`, `waybar/`, `swaync/`, `wlogout/` | `~/.config/` | Arch |
| `backgrounds/` | `~/.config/backgrounds/` | Arch |

---

### Manual Deployment

```bash
git clone git@github.com:vasusheoran/dotfiles.git ~/dotfiles
cd ~/dotfiles
./configure.sh
```

### Cleanup

To remove all symlinks:
```bash
cd ~/dotfiles
./clean.sh
```