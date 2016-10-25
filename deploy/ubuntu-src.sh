#!/bin/bash
RELEASE=$(lsb_release -sc)
sudo apt-get -y update
sudo apt-get -y install wget mc
sudo apt-get -y install build-essential openssl libssl-dev pkg-config python
if [ $RELEASE = 'precise' ]; then
sudo apt-get -y install python-software-properties
sudo add-apt-repository -y ppa:ubuntu-toolchain-r/test
sudo apt-get -y update
sudo apt-get -y install g++-4.8
sudo update-alternatives --quiet --install  /usr/bin/g++ g++ /usr/bin/g++-4.8 1
fi
cd /usr/src
sudo wget http://nodejs.org/dist/v6.9.1/node-v6.9.1.tar.gz
sudo tar zxf node-v6.9.1.tar.gz
sudo rm -f ./node-v6.9.1.tar.gz
cd node-v6.9.1
sudo ./configure
sudo make
sudo make install
cd ~
sudo rm -rf /usr/src/node-v6.9.1
sudo mkdir /ias
cd /ias
sudo npm install nodemailer websocket geoip-lite
sudo npm install impress --unsafe-perm
