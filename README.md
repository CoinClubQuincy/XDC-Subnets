# XDC-Subnets
This is a simple and automate way to set up XDC subnets with a simple script
# Subnet Deployment Script
This script is used to deploy a subnet on XinFin Network.

## Prerequisites

- Docker installed on your machine
- Bash shell (Unix shell)
- Git installed on your machine

## Usage

1. Clone this repository to your local machine.

2. Navigate to the directory containing the `deploy_subnet.sh` script.

3. Run the script with your wallet address and private key as arguments:

```bash
./deploy_subnet.sh YourWalletAddress YourWalletPrivateKey
```

# AWS Seubnet Deployment

This is an AWS CloudFormation template that deploys an EC2 Auto Scaling Group with a Load Balancer in an existing VPC.

## Prerequisites

- AWS Account
- Existing VPC and Subnets
- AWS CLI installed and configured

## Parameters

- `ExistingVpcId`: The ID of an existing VPC.
- `LoadBalancerSubnets`: The IDs of the subnets where the Load Balancer will be deployed.
- `Address`: The address to be passed to the shell script.
- `MinSize`: The minimum size of the auto scaling group.
- `MaxSize`: The maximum size of the auto scaling group.
- `DesiredCapacity`: The desired capacity of the auto scaling group.

## Usage

1. Save the template to a file, for example `template.yaml`.

2. Run the following command to create a CloudFormation stack:

```bash
aws cloudformation create-stack --stack-name MyStack --template-body file://template.yaml --parameters ParameterKey=ExistingVpcId,ParameterValue=<YourVPCId> ParameterKey=LoadBalancerSubnets,ParameterValue=<YourSubnetIds> ParameterKey=Address,ParameterValue=<YourAddress> ParameterKey=MinSize,ParameterValue=<YourMinSize> ParameterKey=MaxSize,ParameterValue=<YourMaxSize> ParameterKey=DesiredCapacity,ParameterValue=<YourDesiredCapacity>