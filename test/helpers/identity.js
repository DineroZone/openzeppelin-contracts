const { ethers } = require('hardhat');

const { P256Signer } = require('./p256');
const { SignatureType } = require('./enums');

class IdentityHelper {
  constructor() {
    this.p256FactoryAsPromise = ethers.deployContract('IdentityP256Factory');
    this.rsaFactoryAsPromise = ethers.deployContract('IdentityRSAFactory');
  }

  async wait() {
    this.p256Factory = await this.p256FactoryAsPromise;
    this.rsaFactory = await this.rsaFactoryAsPromise;
    return this;
  }

  async newECDSASigner() {
    return Object.assign(ethers.Wallet.createRandom(), { type: SignatureType.ECDSA });
  }

  async newP256Signer(params = { withPrefixAddress: true }) {
    await this.wait();

    const signer = P256Signer.random(params);
    await Promise.all([this.p256Factory.predict(signer.publicKey), this.p256Factory.create(signer.publicKey)]).then(
      ([address]) => Object.assign(signer, { address }),
    );

    return signer;
  }

  async newRSASigner() {
    await this.wait();

    return Promise.reject('Not implemented yet');
  }
}

module.exports = {
  SignatureType,
  IdentityHelper,
};