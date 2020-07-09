# Set up new user
echo "Enter username: "

read default_user

adduser $default_user
usermod -aG sudo $default_user
su - $default_user
sudo ls -la /root

# Check
sudo -i -u vasu bash << EOF
whoami