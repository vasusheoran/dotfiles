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

