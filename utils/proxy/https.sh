Refactoring the code and testing for http proxy private and public cluster

1. istiod
2. test cases, code coverage

Which proxies are we supporting
http, http_no_tunnel, socks4, socks5

curl --proxy http://user:vasu%2A123@104.198.217.254:3128 example.com

curl --proxy https://34.122.211.252:3129 example.com

echo "CMD > mkdir -p {{.CertificatesPath}}";
mkdir -p {{.CertificatesPath}}
echo "CMD > cd {{.CertificatesPath}}";
cd {{.CertificatesPath}}

echo "CMD > openssl req -x509 -sha256 -nodes -days 365 -newkey rsa:2048 -subj '/O=NetApp Inc./CN=netapp.com' -keyout netapp.com.key -out netapp.com.crt"
openssl req -x509 -sha256 -nodes -days 365 -newkey rsa:2048 -subj '/O=NetApp Inc./CN=netapp.com' -keyout netapp.com.key -out netapp.com.crt
echo "CMD > openssl req -out appms.netapp.com.csr -newkey rsa:2048 -nodes -keyout appms.netapp.com.key -subj "/CN=appms.netapp.com/O=NetApp organization""
openssl req -out appms.netapp.com.csr -newkey rsa:2048 -nodes -keyout appms.netapp.com.key -subj "/CN=appms.netapp.com/O=NetApp organization"
echo "CMD > openssl x509 -req -days 365 -CA netapp.com.crt -CAkey netapp.com.key -set_serial 0 -in appms.netapp.com.csr -out appms.netapp.com.crt"
openssl x509 -req -days 365 -CA netapp.com.crt -CAkey netapp.com.key -set_serial 0 -in appms.netapp.com.csr -out appms.netapp.com.crt

appms.netapp.com.crt  appms.netapp.com.csr  appms.netapp.com.key  netapp.com.crt  netapp.com.key


https_port 3129 intercept ssl-bump generate-host-certificates=on dynamic_cert_mem_cache_size=4MB key=/etc/squid/certs/appms.netapp.com.key  cert=/etc/squid/certs/appms.netapp.com.crt 

ssl_bump server-first all
sslproxy_flags DONT_VERIFY_PEER
sslproxy_cert_error deny all
sslcrtd_program /usr/lib/squid3/ssl_crtd -s /var/lib/ssl_db -M 4MB sslcrtd_children 8 startup=1 idle=1
coredump_dir /var/spool/squid3

always_direct allow all


http_port 3127 ssl-bump \
   generate-host-certificates=on \
   dynamic_cert_mem_cache_size=4MB \
   key=/etc/squid/certs/appms.netapp.com.key \
   cert=/etc/squid/certs/appms.netapp.com.crt 

ssl_bump server-first all
sslcrtd_program /usr/lib/squid/ssl_crtd -s /var/lib/ssl_db -M 4MB sslcrtd_children 8 startup=1 idle=1
coredump_dir /var/spool/squid

http_port 3128 ssl-bump options=ALL:NO_SSLv3 connection-auth=off generate-host-certificates=off cert=/etc/squid/squid.pem

# Not bypass server certificate validation errors
sslproxy_cert_error deny all
# This one return errors with debian on GCP (https://wiki.squid-cache.org/KnowledgeBase/HostHeaderForgery)
host_verify_strict off

sslproxy_session_cache_size 0

acl step1 at_step SslBump1
acl step2 at_step SslBump2
acl step3 at_step SslBump3


http_access deny all
ssl_bump terminate step3 all





=======
apt-get install -y openssl build-essential libssl-dev wget tar
wget -O - http://www.squid-cache.org/Versions/v3/3.5/squid-3.5.3.tar.gz | tar zxfv -

apt-get build-dep -y apt-get --fix-missing
cd squid-3.5.3 
./configure \
--with-openssl \
--enable-ssl-crtd
make & make install


=====


mkdir /build
cd /build

apt install git autotools-dev automake libtool
git clone https://github.com/squid-cache/squid.git squid

cd squid
git branch -r
git checkout v4

autoreconf -i

./bootstrap.sh
automake (1.15.1) : automake
autoconf (2.69) : autoconf
libtool  (2.4.6) : libtool
libtool path : /usr/bin
Bootstrapping 
parallel-tests: installing 'cfgaux/test-driver'
Fixing configure recursion
Autotool bootstrapping complete.

mkdir build; cd build
pwd

../configure --prefix=/opt/squid --with-default-user=squid --enable-ssl --disable-inlined \
--disable-optimizations --enable-arp-acl --disable-wccp --disable-wccp2 --disable-htcp \
--enable-delay-pools --enable-linux-netfilter --disable-translation --disable-auto-locale \
--with-logdir=/opt/squid/log/squid --with-pidfile=/opt/squid/run/squid.pid \
--enable-ssl-crtd --with-openssl

../configure \
--with-openssl \
--enable-ssl-crtd

make
make install 



chown squid:squid -R /var/lib/ssl_db

# Config file
/usr/local/squid/etc

/usr/local/squid/sbin/squid -k parse
/usr/local/squid/sbin/squid -k reconfigure

export http_proxy=192.168.3.75:3128


cat <<EOF > /etc/squid/squidusers
user:\$apr1\$Z1Bea2lq\$ygfk5pZUnaRu0zEn11Xfd/
EOF

cat <<EOF >/usr/local/squid/etc/squid.conf
# Cred -- user:vasu*123
# Use "sudo htpasswd -c /usr/local/squid/etc/squidusers user" to create new passwords

auth_param basic program /usr/local/squid/libexec/basic_ncsa_auth /usr/local/squid/etc/squidusers
auth_param basic realm proxy
auth_param basic casesensitive off
acl authenticated proxy_auth REQUIRED
http_access allow authenticated

# Choose the port you want. Below we set it to default 3128.
http_port 3127

https_port 3128 intercept ssl-bump \
  cert=/etc/squid/ssl_cert/proxyCA.pem \
  generate-host-certificates=on dynamic_cert_mem_cache_size=4MB

sslcrtd_program /usr/local/squid/libexec/security_file_certgen -s /var/lib/ssl_db -M 4MB

acl step1 at_step SslBump1

ssl_bump peek step1
ssl_bump bump all
EOF

https://user:vasu%2A123@34.122.211.252:3127/


curl --proxy "https://34.123.98.102:3128" example.com

curl --proxy "http://user:vasu*123@192.168.1.33:3128" example.com