const { ethers, artifacts } = require("hardhat");
const { keccak256 } = ethers.utils;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // 1) Deploy UniswapV2Factory (from @uniswap/v2-core, compiled by HH)
  const UniFactory = await ethers.getContractFactory("UniswapV2Factory"); // v0.5.16
  const factory = await UniFactory.deploy(deployer.address); // feeToSetter
  await factory.deployed();
  console.log("Factory:", factory.address);

  // 2) Compute INIT_CODE_PAIR_HASH from Pair creation code (for your logs/UI)
  const pairArtifact = await artifacts.readArtifact("UniswapV2Pair");
  const initCodePairHash = keccak256(pairArtifact.bytecode);
  console.log("INIT_CODE_PAIR_HASH:", initCodePairHash);

  // 3) Deploy WETH9 (local canonical wrapped native)
  const WETH9 = await ethers.getContractFactory("WETH9");
  const weth = await WETH9.deploy();
  await weth.deployed();
  console.log("WETH9:", weth.address);

  // 4) Deploy Router02 (from @uniswap/v2-periphery)
  const Router = await ethers.getContractFactory("UniswapV2Router02"); // v0.6.6
  const router = await Router.deploy(factory.address, weth.address);
  await router.deployed();
  console.log("Router02:", router.address);

  // 5) Deploy two mock tokens: TOKENA, TOKENB
  const supply = ethers.utils.parseEther("1000000");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const tokenA = await MockERC20.deploy("Token A", "TKA", supply);
  await tokenA.deployed();
  console.log("TokenA:", tokenA.address);

  const tokenB = await MockERC20.deploy("Token B", "TKB", supply);
  await tokenB.deployed();
  console.log("TokenB:", tokenB.address);

  // 6) Create the pair (Factory.createPair) and fetch its address
  const txCreate = await factory.createPair(tokenA.address, tokenB.address);
  const rcCreate = await txCreate.wait();
  const pairAddr = await factory.getPair(tokenA.address, tokenB.address);
  console.log("Pair(TKA/TKB):", pairAddr);

  // 7) Approvals for Router
  const approveAmount = ethers.utils.parseEther("1000000000");
  await (await tokenA.approve(router.address, approveAmount)).wait();
  await (await tokenB.approve(router.address, approveAmount)).wait();

  // 8) Add liquidity: 10_000 TKA + 20_000 TKB
  const amountADesired = ethers.utils.parseEther("10000");
  const amountBDesired = ethers.utils.parseEther("20000");
  const amountAMin = 0;
  const amountBMin = 0;
  const to = deployer.address;
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  const txAdd = await router.addLiquidity(
    tokenA.address,
    tokenB.address,
    amountADesired,
    amountBDesired,
    amountAMin,
    amountBMin,
    to,
    deadline
  );
  await txAdd.wait();
  console.log("Liquidity added for TKA/TKB.");

  // 9) Do a tiny test swap via Router: swap 100 TKA -> TKB
  const amountIn = ethers.utils.parseEther("100");
  const amountOutMin = 0;
  const path = [tokenA.address, tokenB.address];

  await (await tokenA.approve(router.address, amountIn)).wait();
  const balBBefore = await tokenB.balanceOf(deployer.address);

  const txSwap = await router.swapExactTokensForTokens(
    amountIn,
    amountOutMin,
    path,
    deployer.address,
    Math.floor(Date.now() / 1000) + 60 * 20
  );
  await txSwap.wait();

  const balBAfter = await tokenB.balanceOf(deployer.address);
  console.log(
    "Swap OK. Received TKB:",
    ethers.utils.formatEther(balBAfter.sub(balBBefore))
  );

  // 10) Log fee switch info (off by default)
  console.log("feeToSetter:", await factory.feeToSetter());
  console.log("feeTo:", await factory.feeTo());
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});