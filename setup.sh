# Set up new user
echo "Creating new user vasu"

default_user=vasu
USERS="$default_user"

for i in $USERS; do
    case `id -u $i > /dev/null 2>&1; echo $?` in
        0)
            # user found
            echo "user '$i' found. Skipping .."
            ;;
        1)
            # user not found
            echo "Adding user '$i' with root privilages"
            adduser $default_user
            usermod -aG sudo $default_user
            su - $default_user
            sudo ls -la /root
            ;;
        *)
            # code if an error occurred
            echo "Error finding go path. Please add manually"
            ;;
    esac
done

# Update
echo "Updating necessary packages .. "
# I would consider these packages essential or very nice to have. The GTK
# version of Vim is to get +clipboard support, you'd still run terminal Vim.
sudo apt-get update && sudo apt-get install -y \
    zsh \
    git \
    python3-pip
    htop \
    shellcheck \
    tmux \
    curl \
    golang-go \
    ripgrep \
    # vim-gtk \
    # gpg \
    # rsync \
    # unzip \
    # pass \

# Install zsh
echo "Setting up plugins and themes for zsh"
case `zsh --version  2>&1 >/dev/null; echo $?` in
    0)
        # zsh found
        echo "zsh found. Skipping Installation.."
        ;;
    1)
        zsh --version
        chsh -s $(which zsh) # Make it default

        # Installing oh-my-zsh
        echo "Installing oh-my-zsh"
        sh -c "$(curl -fsSL https://raw.githubusercontent.com/robbyrussell/oh-my-zsh/master/tools/install.sh)"

        echo "Installing Powerlevel10k theme"
        git clone https://github.com/romkatv/powerlevel10k.git ~/.oh-my-zsh/custom/themes/powerlevel10k

        # Install zsh-plugins
        git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
        git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
        # git clone https://github.com/zsh-users/zsh-completions ${ZSH_CUSTOM:=~/.oh-my-zsh/custom}/plugins/zsh-completions
        
        # Copy zsh/oh-my-zsh settiings
        cd zshrc
        cp -r -v . ~
        ;;
    *)
        # code if an error occurred
        echo "Error install zsh manually"
        ;;
esac

# Setting up git
echo "Setting up config"
git clone https://github.com/vasusheoran/dotfiles.git

cp ~/dotfiles/shell/.gitconfig.user ~/.gitconfig.user
#   && ln -s ~/dotfiles/.tmux.conf ~/.tmux.conf \
# git config --global core.autocrlf false
# git config --list --show-origin

# Install FZF
git clone --depth 1 https://github.com/junegunn/fzf.git ~/.fzf && ~/.fzf/install

# Install AWS CLI v2.
# curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
#   && unzip awscliv2.zip && sudo ./aws/Install && rm awscliv2.zip

  
ln -s ~/dotfiles/shell/.aliasrc ~/..aliasrc \
  && ln -s ~/dotfiles/shell/.bashrc ~/.bashrc \
  && ln -s ~/dotfiles/shell/.profile ~/.profile \
  && ln -s ~/dotfiles/shell/.p10k.zsh ~/.p10k.zsh \
  && ln -s ~/dotfiles/shell/.zshrc ~/.zshrc \
#   && ln -s ~/dotfiles/shell/.fsh.zsh ~/.fsh.zsh \
  && sudo ln -s ~/dotfiles/etc/.wslconf /etc/wsl.conf

[[ ! -f ~/.zshrc ]] || source ~/.zshrc
