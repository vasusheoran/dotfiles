# Update
echo "Updating necessary packages .. "
# I would consider these packages essential or very nice to have. The GTK
# version of Vim is to get +clipboard support, you'd still run terminal Vim.
# sudo apt-get update && sudo apt-get install -y \
#     zsh \
#     git \
#     python3-pip \
#     htop \
#     shellcheck \
#     curl \
#     golang-go \
#     ripgrep \


# Setting up git
echo "Setting up git config"
git clone https://github.com/vasusheoran/dotfiles.git
cp ~/dotfiles/shell/.gitconfig.user ~/.gitconfig.user

# Installing oh-my-zsh
setup_omz() {
  if [ ! -d ~/.oh-my-zsh ]
  then
    echo "Installing oh-my-zsh" 
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/robbyrussell/oh-my-zsh/master/tools/install.sh)"
  else
    echo "Oh-My-Zsh is already installed. Skipping ... "
  fi
  
  if [ ! -d ~/.oh-my-zsh/custom/themes/powerlevel10k ]
  then
    echo "Installing Powerlevel10k theme"
    git clone https://github.com/romkatv/powerlevel10k.git ~/.oh-my-zsh/custom/themes/powerlevel10k
  else
    echo "Powerlevel10k theme is already installed. Skipping ... "
  fi

  setup_plugins_omz
}

setup_plugins_omz(){
  
  echo "Installing oh-my-zsh plugins .."
  if [ ! -d ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting ] 
  then
    git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
  else
    echo "zsh-syntax-highlighting is already installed. Skipping ... "
  fi

  if [ ! -d ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions ] 
  then
    git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
  else
    echo "zsh-autosuggestions is already installed. Skipping ... "
  fi
}

install_fzf(){
  
  if [ ! -d ~/.fzf ]
  then
    echo "Installing FZF"
    git clone --depth 1 https://github.com/junegunn/fzf.git ~/.fzf && ~/.fzf/install
  else
    echo "FZF  is already installed. Skipping ... "
  fi
}

setup_sl(){
# Add links to symbolic files config files  
echo "Creating symbolic links. \n"
ln -sf ~/dotfiles/shell/.alias ~/.alias \
  && ln -sf ~/dotfiles/shell/.bashrc ~/.bashrc \
  && ln -sf ~/dotfiles/shell/.profile ~/.profile \
  && ln -sf ~/dotfiles/shell/.zshrc ~/.zshrc \
  && ln -sf ~/dotfiles/shell/.p10k.zsh ~/.p10k.zsh \
  && sudo ln -sf ~/dotfiles/etc/.wslconf /etc/wsl.conf \
  && ln -sf ~/dotfiles/.gitconfig ~/.gitconfig \
  # && ln -sf ~/dotfiles/shell/.tmux.conf ~/.tmux.conf \

}

setup_omz
install_fzf
setup_sl

echo "Finshed setup. \nLogin again to view changes or use the below command to apply changes. \n    #   source ~/.zshrc \n\n\n\n"