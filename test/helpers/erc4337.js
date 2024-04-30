const { ethers } = require('hardhat');

function pack(left, right) {
  return ethers.solidityPacked(['uint128', 'uint128'], [left, right]);
}

class ERC4337Helper {
  constructor() {
    this.entrypointAsPromise = ethers.deployContract('EntryPoint');
    this.factoryAsPromise = ethers.deployContract('$Create2');
    this.accountAsPromise = ethers.getContractFactory('SimpleAccount');
    this.chainIdAsPromise = ethers.provider.getNetwork().then(({ chainId }) => chainId);
  }

  async wait() {
    this.entrypoint = await this.entrypointAsPromise;
    this.factory = await this.factoryAsPromise;
    this.account = await this.accountAsPromise;
    this.chainId = await this.chainIdAsPromise;
    return this;
  }

  async newAccount(user, salt = ethers.randomBytes(32)) {
    await this.wait();
    const initCode = await this.account
      .getDeployTransaction(this.entrypoint, user)
      .then(tx => this.factory.interface.encodeFunctionData('$deploy', [0, salt, tx.data]))
      .then(deployCode => ethers.concat([this.factory.target, deployCode]));
    const instance = await this.entrypoint.getSenderAddress
      .staticCall(initCode)
      .then(address => this.account.attach(address).connect(user));
    return new AbstractAccount(instance, initCode, this);
  }
}

class AbstractAccount extends ethers.BaseContract {
  constructor(instance, initCode, context) {
    super(instance.target, instance.interface, instance.runner, instance.deployTx);
    this.address = instance.target;
    this.initCode = initCode;
    this.context = context;
  }

  async deploy() {
    this.deployTx = await this.runner.sendTransaction({
      to: '0x' + this.initCode.replace(/0x/, '').slice(0, 40),
      data: '0x' + this.initCode.replace(/0x/, '').slice(40),
    });
    return this;
  }

  async createOp(args = {}) {
    const params = Object.assign({ sender: this }, args);
    // fetch nonce
    if (!params.nonce) {
      params.nonce = await this.context.entrypointAsPromise.then(entrypoint => entrypoint.getNonce(this, 0));
    }
    // prepare paymaster and data
    if (ethers.isAddressable(params.paymaster)) {
      params.paymaster = await ethers.resolveAddress(params.paymaster);
      params.paymasterVerificationGasLimit ??= 100_000n;
      params.paymasterPostOpGasLimit ??= 100_000n;
      params.paymasterAndData = ethers.solidityPacked(
        ['address', 'uint128', 'uint128'],
        [params.paymaster, params.paymasterVerificationGasLimit, params.paymasterPostOpGasLimit],
      );
    }
    return new UserOperation(params);
  }
}

class UserOperation {
  constructor(params) {
    this.sender = params.sender;
    this.nonce = params.nonce;
    this.initCode = params.initCode ?? '0x';
    this.callData = params.callData ?? '0x';
    this.verificationGas = params.verificationGas ?? 10_000_000n;
    this.callGas = params.callGas ?? 100_000n;
    this.preVerificationGas = params.preVerificationGas ?? 100_000n;
    this.maxPriorityFee = params.maxPriorityFee ?? 100_000n;
    this.maxFeePerGas = params.maxFeePerGas ?? 100_000n;
    this.paymasterAndData = params.paymasterAndData ?? '0x';
    this.signature = params.signature ?? '0x';
  }

  get packed() {
    return {
      sender: this.sender,
      nonce: this.nonce,
      initCode: this.initCode,
      callData: this.callData,
      accountGasLimits: pack(this.verificationGas, this.callGas),
      preVerificationGas: this.preVerificationGas,
      gasFees: pack(this.maxPriorityFee, this.maxFeePerGas),
      paymasterAndData: this.paymasterAndData,
      signature: this.signature,
    };
  }

  get hash() {
    const p = this.packed;
    const h = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256', 'bytes32', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256'],
        [
          p.sender.target,
          p.nonce,
          ethers.keccak256(p.initCode),
          ethers.keccak256(p.callData),
          p.accountGasLimits,
          p.preVerificationGas,
          p.gasFees,
          ethers.keccak256(p.paymasterAndData),
        ],
      ),
    );
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'address', 'uint256'],
        [h, this.sender.context.entrypoint.target, this.sender.context.chainId],
      ),
    );
  }

  addInitCode() {
    this.initCode = this.sender.initCode;
    return this;
  }

  async sign(signer = this.sender.runner) {
    this.signature = await signer.signMessage(ethers.toBeArray(this.hash));
    return this;
  }
}

module.exports = {
  ERC4337Helper,
  AbstractAccount,
  UserOperation,
};
