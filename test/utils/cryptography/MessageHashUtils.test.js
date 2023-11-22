const { ethers } = require('hardhat');
const { expect } = require('chai');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

const { domainSeparator, hashTypedData } = require('../../helpers/eip712');

async function fixture() {
  const mock = await ethers.deployContract('$MessageHashUtils');

  // const message = ethers.getBytes('0xabcd');
  // const messageHash = ethers.getBytes(ethers.sha256(message));
  // const verifyingAddress = ethers.getAddress(ethers.hexlify(ethers.randomBytes(20)));

  return { mock };
}

describe('MessageHashUtils', function () {
  beforeEach(async function () {
    Object.assign(this, await loadFixture(fixture));
  });

  describe('toEthSignedMessageHash', function () {
    it('prefixes bytes32 data correctly', async function () {
      const message = ethers.randomBytes(32);
      expect(await this.mock.getFunction('$toEthSignedMessageHash(bytes32)')(message)).to.equal(
        ethers.hashMessage(message),
      );
    });

    it('prefixes dynamic length data correctly', async function () {
      const message = ethers.randomBytes(128);
      expect(await this.mock.getFunction('$toEthSignedMessageHash(bytes)')(message)).to.equal(
        ethers.hashMessage(message),
      );
    });

    it('version match for bytes32', async function () {
      const message = ethers.randomBytes(32);
      const fixed = await this.mock.getFunction('$toEthSignedMessageHash(bytes32)')(message);
      const dynamic = await this.mock.getFunction('$toEthSignedMessageHash(bytes)')(message);
      expect(fixed).to.equal(dynamic);
    });
  });

  describe('toDataWithIntendedValidatorHash', function () {
    it('returns the digest correctly', async function () {
      const verifier = ethers.Wallet.createRandom().address;
      const message = ethers.randomBytes(128);

      const expectedHash = ethers.solidityPackedKeccak256(
        ['string', 'address', 'bytes'],
        ['\x19\x00', verifier, message],
      );

      expect(await this.mock.$toDataWithIntendedValidatorHash(verifier, message)).to.equal(expectedHash);
    });
  });

  describe('toTypedDataHash', function () {
    it('returns the digest correctly', async function () {
      const domain = {
        name: 'Test',
        version: 1n,
        chainId: 1n,
        verifyingContract: ethers.Wallet.createRandom().address,
      };
      const structhash = ethers.randomBytes(32);

      expect(await this.mock.$toTypedDataHash(domainSeparator(domain), structhash)).to.equal(
        hashTypedData(domain, structhash),
      );
    });
  });
});
