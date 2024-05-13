#!/bin/bash
#./deploy_subnet.sh YourWalletAddress YourWalletPrivateKey

# Check if wallet address and private key are passed as arguments
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 YourWalletAddress YourWalletPrivateKey"
    exit 1
fi

PARENTNET_WALLET_PK=$1
WALLET_PRIVATE_KEY=$2

sudo apt-get update

# Install packages to allow apt to use a repository over HTTPS
sudo apt-get install \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add Docker’s official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Set up the stable repository
echo \
  "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Update the apt package index, and install Docker engine
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io

git clone https://github.com/XinFinOrg/XinFin-Node.git
echo "Cloned XinFin-Node"

cd XinFin-Node/subnet/deployment-generator/
echo "Cloned XinFin-Node"

cp script/docker.env.example docker.env
echo "Created docker.env"

# Update the env file
NETWORK_NAME="xdcsubnet"
NUM_MACHINE="1"
NUM_SUBNET="3"
MAIN_IP=$(curl -s ifconfig.me)
PARENTNET="devnet"

grep -q '^CONFIG_PATH=' docker.env || sed -i'' '1iCONFIG_PATH='"$PWD" docker.env
sed -i "s|NETWORK_NAME=.*|NETWORK_NAME=$NETWORK_NAME|" docker.env
sed -i "s|NUM_MACHINE=.*|NUM_MACHINE=$NUM_MACHINE|" docker.env
sed -i "s|NUM_SUBNET=.*|NUM_SUBNET=$NUM_SUBNET|" docker.env
sed -i "s|MAIN_IP=.*|MAIN_IP=$MAIN_IP|" docker.env
sed -i "s|PARENTNET=.*|PARENTNET=$PARENTNET|" docker.env
sed -i "s|PARENTNET_WALLET_PK=.*|PARENTNET_WALLET=$PARENTNET_WALLET_PK|" docker.env
grep -q '^PARENTCHAIN_WALLET_PK=' docker.env || echo "PARENTCHAIN_WALLET_PK=$WALLET_PRIVATE_KEY" >> docker.env
grep -q '^PRIVATE_KEY=' docker.env || echo "PRIVATE_KEY=$WALLET_PRIVATE_KEY" >> docker.env

sudo docker pull xinfinorg/subnet-generator:latest

sudo docker run --env-file docker.env -v $(pwd)/generated:/app/generated xinfinorg/subnet-generator:latest && cd generated

sudo docker compose --env-file docker-compose.env --profile machine1 pull
sudo docker compose --env-file docker-compose.env --profile machine1 up -d

cd ../

sudo docker run --env-file docker.env \
    -v $(pwd)/generated/deployment.json:/app/generated/deployment.json \
    --entrypoint 'bash' xinfinorg/subnet-generator:latest /app/start.sh

cd generated

sudo docker compose --env-file docker-compose.env --profile services pull
sudo docker compose --env-file docker-compose.env --profile services up -d






