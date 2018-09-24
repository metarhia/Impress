#!/bin/bash
RELEASE=$(lsb_release -sc)
sudo apt-get -y update
sudo apt-get -y install wget mc
sudo apt-get -y install build-essential openssl libssl-dev pkg-config python
sudo apt-get -y install software-properties-common
sudo add-apt-repository -y ppa:certbot/certbot
sudo apt-get -y update
sudo apt-get -y install certbot
curl -sL https://deb.nodesource.c
if [ $RELEASE = 'precise' ]; then
sudo apt-get -y install python-software-properties
sudo add-apt-repository -y ppa:ubuntu-toolchain-r/test
sudo apt-get -y update
sudo apt-get -y install g++-4.8
sudo update-alternatives --quiet --install  /usr/bin/g++ g++ /usr/bin/g++-4.8 1
fi
cd /usr/src
sudo wget https://nodejs.org/dist/v10.5.0/node-v10.5.0.tar.gz
sudo tar zxf node-v10.5.0.tar.gz
sudo rm -f ./node-v10.5.0.tar.gz
cd node-v10.5.0
sudo ./configure
sudo make
sudo make install
cd ~
sudo rm -rf /usr/src/node-v10.5.0
sudo mkdir /ias
cd /ias
sudo npm install nodemailer websocket geoip-lite
sudo npm install impress --unsafe-perm
echo 'To generate certificates run "certbot certonly" under root'
