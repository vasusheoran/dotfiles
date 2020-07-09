# Update
echo "Updating necessary packages .. "
# I would consider these packages essential or very nice to have. The GTK
# version of Vim is to get +clipboard support, you'd still run terminal Vim.
sudo apt-get update && sudo apt-get install -y \
    zsh \
    git \
    python3-pip \
    htop \
    shellcheck \
    curl \
    golang-go \
    ripgrep \
    # tmux \
    # vim-gtk \
    # gpg \
    # rsync \
    # unzip \
    # pass \


# Setting up git
echo "Setting up git config"
git clone https://github.com/vasusheoran/dotfiles.git
cp ~/dotfiles/shell/.gitconfig.user ~/.gitconfig.user

# Installing oh-my-zsh
echo "Installing oh-my-zsh"
sh -c "$(curl -fsSL https://raw.githubusercontent.com/robbyrussell/oh-my-zsh/master/tools/install.sh)"
sudo chsh -s $(which zsh) $(whoami)

echo "Installing Powerlevel10k theme"
[[ ! -f ~/.oh-my-zsh/custom/themes/powerlevel10k ]] || git clone https://github.com/romkatv/powerlevel10k.git ~/.oh-my-zsh/custom/themes/powerlevel10k

# Install zsh-plugins
[[ ! -f ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting ]] || git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
[[ ! -f ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions ]] || git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
# git clone https://github.com/zsh-users/zsh-completions ${ZSH_CUSTOM:=~/.oh-my-zsh/custom}/plugins/zsh-completions

# Install FZF
[[ ! -f ~/.fzf ]] || git clone --depth 1 https://github.com/junegunn/fzf.git ~/.fzf && ~/.fzf/install

# Add links to symbolic files config files  
ln -sf ~/dotfiles/shell/.alias ~/.alias \
  && ln -sf ~/dotfiles/shell/.bashrc ~/.bashrc \
  && ln -sf ~/dotfiles/shell/.profile ~/.profile \
  && ln -sf ~/dotfiles/shell/.zshrc ~/.zshrc \
  && ln -sf ~/dotfiles/shell/.p10k.zsh ~/.p10k.zsh \
  && sudo ln -sf ~/dotfiles/etc/.wslconf /etc/wsl.conf \
  && ln -s ~/dotfiles/.gitconfig ~/.gitconfig \
  # && ln -sf ~/dotfiles/shell/.tmux.conf ~/.tmux.conf \

[[ ! -f ~/.zshrc ]] || source ~/.zshrc
