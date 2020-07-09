# Set up new user
echo "Enter username: " && read default_user

case `id -u $default_user > /dev/null 2>&1; echo $?` in
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