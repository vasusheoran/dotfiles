user=vasu
ip=10.193.160.147
key=$HOME/.ssh/open.lab.key.pub

## Create Key
## ssh-keygen -t rsa -b 4096 "vasusheoran"
## chmod 400 gcp_key

## First create .ssh directory on server ##
ssh $user@$ip "umask 077; test -d .ssh || mkdir .ssh"
 
## cat local id.rsa.pub file and pipe over ssh to append the public key in remote server ##
c at $key | ssh $user@$ip "cat >> ~/.ssh/authorized_keys"
 
### ssh-keygen -t rsa -b 4096 -f default_key 