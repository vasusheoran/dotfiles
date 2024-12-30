# Ubuntu Dotfiles

## Features

These dotfiles make setting up your new Ubuntu VM for development a breeze. They configure essential applications, customize your command-line experience, and even generate SSH keys for secure access.

**Here's what you get:**

* **Essential applications:** Install popular IDEs, development tools, and utilities with ease using `apps.sh`.
* **Command-line power:** Enhance your terminal with `Oh My Zsh!`, custom `.zshrc` configurations, and Git settings from `cli.sh`.
* **Secure access:** Generate SSH keys with `ssh.sh` and simplify remote development workflows.
* **Dedicated workspace:** Organize your projects with a dedicated `dev` directory created automatically.
* **Persistent customization:** After installation, your `.zshrc` settings remain intact for a personalized terminal experience.

## Installation files

The magic happens under the hood with these helpful scripts:

* `apps.sh`: Installs essential development applications.
* `cli.sh`: Sets up `Oh My Zsh!`, configures your `.zshrc`, and tweaks Git settings.
* `install.sh`: The main installer script that orchestrates the setup process.
* `ssh.sh`: Generates SSH keys based on your email address (configured in `.env`).
* `utils.sh`: Provides useful helper functions for other installers.
* `.zshrc`: Your personalized terminal configuration file (becomes permanent after installation).

## Install dotfiles

Follow these simple steps to transform your VM into a developer haven:

1. **Make the scripts executable:** Run `chmod 700 dotfiles/ -R` in your terminal.
2. **Navigate to the dotfiles directory:** `cd dotfiles`.
3. **Run the setup script:** Execute `./install.sh`.
4. **Sit back and relax:** The script will handle the rest, informing you of its progress.

Enjoy a prepped and productive development environment tailored just for you!

**Additional notes:**

* Customize application versions and preferred tools through the `.env` file.
* Explore the `scripts` directory for further configuration options.
* Feel free to contribute your own scripts and improvements to the project!
* This dotfiles project draws inspiration from the excellent WSL setup script by Samuel Ramox ([https://github.com/samuelramox/wsl-setup](https://github.com/samuelramox/wsl-setup))

We hope you find these dotfiles as useful as we do!


## nvim
```shell
git clone https://github.com/vasusheoran/nvim-config.git "${XDG_CONFIG_HOME:-$HOME/.config}"/nvim
```