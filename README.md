# WSL Debian/Ubuntu Dotfiles

## Features

### Installation files

- [apps.sh](scripts/apps.sh) - installs applications.
- [cli.sh](scripts/cli.sh) - installs _Oh My Zsh_, _.zshrc_ and _Git_ configs.
- [install.sh](install.sh) - main installer.
- [ssh.sh](scripts/ssh.sh) - generate _SSH_.
- [utils.sh](scripts/utils.sh) - support functions for other installers.
- [.zshrc](scripts/.zshrc) - terminal configs with aliases, paths, plugins and theme (this file is permanent after installation).

### Install dotfiles
```sh
chmod 700 dotfiles/ -R
cd dotfiles
./install.sh
```