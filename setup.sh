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
    # vim-gtk \
    # gpg \
    # rsync \
    # unzip \
    # ripgrep \
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
echo "Setting up git config"
git config --global user.name "Vasu Sheoran"
git config --global user.email "gokusayon@gmail.com"
git config --global core.autocrlf false
git config --list --show-origin

# Install Go Lang
echo "Installing Go"
case `go version 2>&1 >/dev/null; echo $?` in
    0)
        # git found
        echo "go found. Skipping Installation.."
        ;;
    *)
        # code if an error occurred
        echo "Installing go"
        sudo apt install -y golang-go
        ;;
esac

# Export Go path
String="GOPATH"
FILE_LIST='./.zshrc ./.profile'

cd ~
for i in $FILE_LIST; do
    case `grep -Fq "$String" "$i" >/dev/null; echo $?` in
        0)
            # code if found
            echo "Go path already exists in $i. Skipping .."
            ;;
        1)
            # code if not found
            echo "Appending GO env variable to $i"
            echo "\n" >> "$i"
            echo "# Go variables" >> "$i"
            echo "export GOPATH=$HOME/go" >> "$i"
            echo "export PATH=\$PATH:/usr/local/go/bin:\$GOPATH/bin" >> "$i"
            ;;
        *)
            # code if an error occurred
            echo "Error finding go path in $i. Please add manually"
            ;;
    esac
done

