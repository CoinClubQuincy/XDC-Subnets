# Niuclei Subnet — Documentation & Deployment Guide

## 📖 Overview

**Niuclei Subnet** is a sovereign blockchain network built using the [XDC Subnet architecture](https://docs.xdc.network/).  
It is designed to provide:

- **Permissioned validator control** (owner decides who runs nodes).  
- **DPoS + HotStuff consensus** (fast finality, forensic monitoring).  
- **Optional anchoring to XDC Mainnet** via a **Checkpoint Smart Contract (CSC)**.  
- **Cross-chain interoperability** via **XDCZero** (Endpoints, Relayers, Oracles).  
- **Cross-chain token transfers** via **Subswap** (mint/burn, lock/unlock).  

This project deploys **Niuclei Subnet** as an **EC2 Auto Scaling Group behind an Application Load Balancer (ALB)**, with hardened security and HTTPS access to all subnet UIs.

---

## ⚙️ Architecture

- **Subnet Nodes**: Run inside an EC2 Auto Scaling Group (Linux + Docker).  
- **Wizard (port 5210)**: Web UI to generate configs (`docker-compose.yml`, env files, genesis).  
- **Subnet UI (port 5214)**: Monitor blocks, masternodes, throughput.  
- **Relayer UI (port 5215)**: Manage cross-chain relayer operations.  
- **ALB**: Routes external traffic via HTTPS to the correct service.  
- **Security**:  
  - Secrets (private keys) stored in **AWS SSM Parameter Store (SecureString)**.  
  - Separate **ALB SG** (public 80/443) and **Instance SG** (only ALB→instances).  
  - Optional **AWS WAFv2** WebACL.  
  - Optional **VPC Flow Logs**.  

---

## 📋 Prerequisites

Before deployment, make sure you have:

1. **AWS account** with permissions for EC2, AutoScaling, ALB, IAM, SSM, CloudWatch.  
2. **Key Pair** for EC2 SSH access.  
3. **ACM Certificate** (issued in the same region as your ALB) for HTTPS.  
4. **Parentnet RPC endpoint**:  
   - **Apothem (testnet)**: `https://rpc.apothem.network`  
   - **Mainnet**: `https://erpc.xinfin.network`  
5. **Owner/Relayer Wallet**:  
   - Public address (0x...).  
   - Private key stored in SSM:
     ```bash
     aws ssm put-parameter        --name "/niuclei/owner_pk"        --type "SecureString"        --value "0xYOUR_PRIVATE_KEY"
     ```

---

## 🚀 Deployment (CloudFormation)

1. **Download the template**  
   File: `nuclei-subnet-multichain.cfn.yaml`

2. **Deploy stack**  
   Use AWS Console or CLI:
   ```bash
   aws cloudformation create-stack      --stack-name Niuclei-Subnet      --template-body file://nuclei-subnet-multichain.cfn.yaml      --capabilities CAPABILITY_NAMED_IAM      --parameters        ParameterKey=ExistingVpcId,ParameterValue=vpc-xxxx        ParameterKey=LoadBalancerSubnets,ParameterValue='subnet-aaa,subnet-bbb'        ParameterKey=Address,ParameterValue=0xYourOwnerAddress        ParameterKey=RelayerPrivateKeySsmPath,ParameterValue=/niuclei/owner_pk        ParameterKey=ParentnetRpcUrl,ParameterValue=https://rpc.apothem.network        ParameterKey=MinSize,ParameterValue=1        ParameterKey=MaxSize,ParameterValue=2        ParameterKey=DesiredCapacity,ParameterValue=1        ParameterKey=instanceSize,ParameterValue=t3.large        ParameterKey=AllowedAdminCidr,ParameterValue=YOUR_IP/32        ParameterKey=AlbAllowedCidr,ParameterValue=0.0.0.0/0        ParameterKey=AcmCertificateArn,ParameterValue=arn:aws:acm:REGION:ACCOUNT:certificate/XXXX
   ```

3. **Outputs**  
   After deployment, note these stack outputs:
   - `WizardUrl` → Wizard (setup configs).  
   - `SubnetUiUrl` → Subnet dashboard.  
   - `RelayerUiUrl` → Relayer dashboard.  
   - `LoadBalancerDNSName` → Base ALB hostname.  

---

## 🛠 Usage

1. **Open the Wizard** (`WizardUrl`)  
   - Configure your subnet (validator count, chainId, epoch length, etc.).  
   - Click **Start**.  
   - The system will generate configs in `/opt/nuclei/generated/`.  

2. **Auto-Continue service**  
   - Detects `generated/commands.txt`.  
   - Runs:
     ```bash
     docker compose --env-file docker-compose.env --profile machine1 up -d
     docker compose --env-file docker-compose.env --profile services up -d
     ```
   - Subnet nodes + services are started automatically.  

3. **Monitor**  
   - Subnet UI: block explorer, masternode status.  
   - Relayer UI: cross-chain relayer monitoring.  

---

## 🌉 Multi-Network (Subswap Integration)

To connect Niuclei Subnet to **multiple networks** (Apothem, Mainnet, other subnets):

1. Create a `chains.json` (example provided in repo):
   ```json
   [
     {
       "name": "XDC Apothem",
       "chainId": 51,
       "rpc": "https://rpc.apothem.network",
       "endpoint": "0xEndpointOnApothem",
       "csc": "0xCscOnApothem",
       "parentnetTreasury": "0xParentTreasuryOnApothem",
       "subnetTreasury": "0xSubnetTreasuryOnNiuclei"
     }
   ]
   ```

2. Run the helper script:
   ```bash
   ENDPOINT_SUBNET=0xYourSubnetEndpoint    SUBNET_TREASURY=0xYourSubnetTreasury    SUBNET_RPC=http://127.0.0.1:8545    OWNER_PK=$(aws ssm get-parameter --with-decryption --name "/niuclei/owner_pk" --query Parameter.Value --output text)    ./nuclei-endpoint-approvals.sh chains.json
   ```

3. This calls `registerChain` and `approveApplication` for each target chain.

---

## 🔒 Security Best Practices

- Store all keys in **SSM Parameter Store** (SecureString).  
- Restrict SSH with `AllowedAdminCidr=YOUR_IP/32`.  
- Use **Apothem testnet** before moving to **Mainnet**.  
- Monitor **Relayer** health and CSC commits in the Subnet UI.  
- Rotate keys periodically and use different keys for relayer vs owner.  

---

## 📂 Repository Structure

```
/docs
  └── README.md   (this file)
/templates
  └── nuclei-subnet-multichain.cfn.yaml
/scripts
  └── nuclei-endpoint-approvals.sh
/chains.example.json
```

---

## ✅ Next Steps

- Deploy Niuclei Subnet (Apothem first).  
- Confirm checkpoint commits appear in CSC.  
- Add more validators via the Subnet UI.  
- Register multiple networks for Subswap interoperability.  

# Niuclei Subnet — Documentation & Deployment Guide

## 📖 Overview

**Niuclei Subnet** is a sovereign blockchain network built using the [XDC Subnet architecture](https://docs.xdc.network/).  
It is designed to provide:

- **Permissioned validator control** (owner decides who runs nodes).  
- **DPoS + HotStuff consensus** (fast finality, forensic monitoring).  
- **Optional anchoring to XDC Mainnet** via a **Checkpoint Smart Contract (CSC)**.  
- **Cross-chain interoperability** via **XDCZero** (Endpoints, Relayers, Oracles).  
- **Cross-chain token transfers** via **Subswap** (mint/burn, lock/unlock).  
- **DEX support** via integrated **Uniswap v3 deployment runner**.  
- **UI configuration generator** for SFTR and multi-network token routing.  

This project deploys **Niuclei Subnet** as an **EC2 Auto Scaling Group behind an Application Load Balancer (ALB)**, with hardened security, HTTPS access to all subnet UIs, and an **API Gateway–moderated RPC endpoint**.

---

## ⚙️ Architecture

- **Subnet Nodes**: EC2 Auto Scaling Group (Amazon Linux 2023 + Docker).  
- **Wizard (port 5210)**: Web UI to generate configs (`docker-compose.yml`, env files, genesis).  
- **Subnet UI (port 5214)**: Monitor blocks, masternodes, throughput.  
- **Relayer UI (port 5215)**: Manage cross-chain relayer operations.  
- **DEX Runner**: Optional Uniswap v3 deployment (SFTR as base token).  
- **UI Config Generator**: Writes `tokenlist.json` and `bases.json` for SFTR across 3 networks.  
- **ALB**: Routes external traffic via HTTPS with path-based routing:
  - `/wizard*` → Wizard
  - `/relayer*` → Relayer UI
  - `/rpc*` → RPC (behind API Gateway header guard)
  - `/*` → Subnet UI
- **API Gateway (optional)**: Provides moderated RPC endpoint with throttling.  
- **Security**:  
  - Secrets (private keys) stored in **AWS SSM Parameter Store (SecureString)**.  
  - Separate **ALB SG** (public 80/443) and **Instance SG** (only ALB→instances).  
  - **API Gateway header guard** ensures only Gateway traffic reaches RPC port 8545.  
  - Optional **AWS WAFv2** WebACL.  
  - Optional **VPC Flow Logs**.  

---

## 📋 Prerequisites

1. **AWS account** with permissions for EC2, AutoScaling, ALB, IAM, SSM, CloudWatch, API Gateway.  
2. **Key Pair** for EC2 SSH access (optional).  
3. **ACM Certificate** (issued in the same region as your ALB) for HTTPS.  
4. **Parentnet RPC endpoint**:  
   - **Apothem (testnet)**: `https://rpc.apothem.network`  
   - **Mainnet**: `https://erpc.xinfin.network`  
5. **Owner/Relayer Wallet**:  
   - Public address (0x...).  
   - Private key stored in SSM:  
     ```bash
     aws ssm put-parameter \
       --name "/niuclei/owner_pk" \
       --type "SecureString" \
       --value "0xYOUR_PRIVATE_KEY"
     ```
6. **SFTR Token Deployment**: Provide addresses for SFTR on each network (Apothem, Mainnet, Subnet).  

---

## 🚀 Deployment (CloudFormation)

1. **Download the template**  
   File: `nuclei-subnet-multichain.cfn.yaml`

2. **Deploy stack**  
   Example CLI:
   ```bash
   aws cloudformation create-stack \
     --stack-name Niuclei-Subnet \
     --template-body file://nuclei-subnet-multichain.cfn.yaml \
     --capabilities CAPABILITY_NAMED_IAM \
     --parameters \
       ParameterKey=ExistingVpcId,ParameterValue=vpc-xxxx \
       ParameterKey=LoadBalancerSubnets,ParameterValue='subnet-aaa,subnet-bbb' \
       ParameterKey=Address,ParameterValue=0xYourOwnerAddress \
       ParameterKey=RelayerPrivateKeySsmPath,ParameterValue=/niuclei/owner_pk \
       ParameterKey=ParentnetRpcUrl,ParameterValue=https://rpc.apothem.network \
       ParameterKey=MinSize,ParameterValue=1 \
       ParameterKey=MaxSize,ParameterValue=2 \
       ParameterKey=DesiredCapacity,ParameterValue=1 \
       ParameterKey=instanceSize,ParameterValue=t3.large \
       ParameterKey=AllowedAdminCidr,ParameterValue=YOUR_IP/32 \
       ParameterKey=AlbAllowedCidr,ParameterValue=0.0.0.0/0 \
       ParameterKey=AcmCertificateArn,ParameterValue=arn:aws:acm:REGION:ACCOUNT:certificate/XXXX \
       ParameterKey=EnableRpcApi,ParameterValue=true \
       ParameterKey=RpcHeaderValue,ParameterValue=SHARED_SECRET \
       ParameterKey=EnableUiConfig,ParameterValue=true \
       ParameterKey=NetAName,ParameterValue=nuclei \
       ParameterKey=NetAChain,ParameterValue=12345 \
       ParameterKey=NetASFTR,ParameterValue=0xAAA... \
       ParameterKey=NetBName,ParameterValue=apothem \
       ParameterKey=NetBChain,ParameterValue=51 \
       ParameterKey=NetBSFTR,ParameterValue=0xBBB... \
       ParameterKey=NetCName,ParameterValue=mainnet \
       ParameterKey=NetCChain,ParameterValue=50 \
       ParameterKey=NetCSFTR,ParameterValue=0xCCC...
   ```

3. **Outputs**  
   After deployment, note these stack outputs:
   - `WizardUrl` → Wizard (setup configs).  
   - `SubnetUiUrl` → Subnet dashboard.  
   - `RelayerUiUrl` → Relayer dashboard.  
   - `RpcApiInvokeUrl` → Moderated RPC endpoint (API Gateway).  
   - `LoadBalancerDNSName` → Base ALB hostname.  

---

## 🛠 Usage

1. **Open the Wizard** (`WizardUrl`)  
   Configure subnet parameters (validators, chainId, epoch length). Click **Start**. Configs will generate into `/opt/nuclei/generated/`.

2. **Auto-Continue service**  
   Automatically detects `generated/commands.txt` and starts subnet nodes + services with Docker Compose.

3. **DEX Deployment**  
   If `DexAutoDeploy=true`, the bootstrap runs the included **Uniswap v3 deployment script**.  
   - SFTR is used as the **base token** instead of WXDC/WETH9.  
   - ERC‑20 ↔ ERC‑20 pools (SFTR/USDC, SFTR/DAI, SFTR/ANY_ERC20) are supported.  
   - Native coin routing is disabled.  

4. **UI Config Generator**  
   Creates `/opt/dex/interface/tokenlist.json` and `/opt/dex/interface/bases.json` for the default network, plus subfolders for each configured network (A/B/C).  
   - SFTR is marked as a base token.  
   - `hideNative=true` ensures WXDC/native paths are hidden.  

5. **Monitor**  
   - Subnet UI: block explorer, masternode status.  
   - Relayer UI: cross-chain relayer monitoring.  
   - RPC: via `RpcApiInvokeUrl` (no API key required).  

---

## 🌉 Multi-Network (Subswap Integration)

To connect Niuclei Subnet to **multiple networks** (Apothem, Mainnet, other subnets):

1. Define your `chains.json` with target networks.  
2. Run helper script:
   ```bash
   ENDPOINT_SUBNET=0xYourSubnetEndpoint \
   SUBNET_TREASURY=0xYourSubnetTreasury \
   SUBNET_RPC=http://127.0.0.1:8545 \
   OWNER_PK=$(aws ssm get-parameter --with-decryption --name "/niuclei/owner_pk" --query Parameter.Value --output text) \
   ./nuclei-endpoint-approvals.sh chains.json
   ```
3. The script calls `registerChain` and `approveApplication` for each network.

---

## 🔒 Security Best Practices

- Store all keys in **SSM Parameter Store**.  
- Restrict SSH (`AllowedAdminCidr=YOUR_IP/32`).  
- Use **Apothem testnet** before Mainnet.  
- Monitor **Relayer** and **CSC commits**.  
- Rotate keys and separate relayer/owner roles.  
- For RPC: rely on API Gateway for moderation + throttling.  

---

## 📂 Repository Structure

```
/docs
  └── Nuclei-Subnet-README.md (this file)
/templates
  └── nuclei-subnet-multichain.cfn.yaml
/scripts
  └── nuclei-endpoint-approvals.sh
/chains.example.json
```

---

## ✅ Next Steps

- Deploy Niuclei Subnet (Apothem first).  
- Confirm checkpoint commits in CSC.  
- Add validators via Subnet UI.  
- Register multiple networks for Subswap.  
- Deploy SFTR/USDC pools and verify UI integration.  