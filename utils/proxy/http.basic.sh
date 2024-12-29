#!/bin/bash

apt-get update
apt install squid apache2-utils -y
cp /etc/squid/squid.conf /etc/squid/squid.conf.bak

cat <<EOF > /etc/squid/squidusers
user:\$apr1\$Z1Bea2lq\$ygfk5pZUnaRu0zEn11Xfd/
EOF

cat <<EOF >/etc/squid/squid.conf
# Cred -- user:vasu*123
# Use "sudo htpasswd -c /etc/squid/squidusers user" to create new passwords

auth_param basic program /usr/lib/squid/basic_ncsa_auth /etc/squid/squidusers
auth_param basic realm proxy
auth_param basic casesensitive off
acl authenticated proxy_auth REQUIRED
http_access allow authenticated

# Choose the port you want. Below we set it to default 3128.
http_port 3128
EOF

systemctl restart squid
# systemctl status squid