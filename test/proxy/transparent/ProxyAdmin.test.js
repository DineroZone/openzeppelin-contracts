const { expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');
const ImplV1 = artifacts.require('DummyImplementation');
const ImplV2 = artifacts.require('DummyImplementationV2');
const ProxyAdmin = artifacts.require('ProxyAdmin');
const TransparentUpgradeableProxy = artifacts.require('TransparentUpgradeableProxy');
const ITransparentUpgradeableProxy = artifacts.require('ITransparentUpgradeableProxy');

const { getAddressInSlot, ImplementationSlot } = require('../../helpers/erc1967');
const { expectRevertCustomError } = require('../../helpers/customError');

contract('ProxyAdmin', function (accounts) {
  const [proxyAdminOwner, anotherAccount] = accounts;

  before('set implementations', async function () {
    this.implementationV1 = await ImplV1.new();
    this.implementationV2 = await ImplV2.new();
  });

  beforeEach(async function () {
    const initializeData = Buffer.from('');
    this.proxyAdmin = await ProxyAdmin.new(proxyAdminOwner);
    const proxy = await TransparentUpgradeableProxy.new(
      this.implementationV1.address,
      this.proxyAdmin.address,
      initializeData,
    );
    this.proxy = await ITransparentUpgradeableProxy.at(proxy.address);
  });

  it('has an owner', async function () {
    expect(await this.proxyAdmin.owner()).to.equal(proxyAdminOwner);
  });

  describe('#upgradeAndCall', function () {
    context('with unauthorized account', function () {
      it('fails to upgrade', async function () {
        const callData = new ImplV1('').contract.methods.initializeNonPayableWithValue(1337).encodeABI();
        await expectRevertCustomError(
          this.proxyAdmin.upgradeAndCall(this.proxy.address, this.implementationV2.address, callData, {
            from: anotherAccount,
          }),
          'OwnableUnauthorizedAccount',
          [anotherAccount],
        );
      });
    });

    context('with authorized account', function () {
      context('with empty callData', function () {
        it('upgrades implementation', async function () {
          const callData = '0x';
          await this.proxyAdmin.upgradeAndCall(this.proxy.address, this.implementationV2.address, callData, {
            from: proxyAdminOwner,
          });
          const implementationAddress = await getAddressInSlot(this.proxy, ImplementationSlot);
          expect(implementationAddress).to.be.equal(this.implementationV2.address);
        });
      });

      context('with invalid callData', function () {
        it('fails to upgrade', async function () {
          const callData = '0x12345678';
          await expectRevert.unspecified(
            this.proxyAdmin.upgradeAndCall(this.proxy.address, this.implementationV2.address, callData, {
              from: proxyAdminOwner,
            }),
          );
        });
      });

      context('with valid callData', function () {
        it('upgrades implementation', async function () {
          const callData = new ImplV1('').contract.methods.initializeNonPayableWithValue(1337).encodeABI();
          await this.proxyAdmin.upgradeAndCall(this.proxy.address, this.implementationV2.address, callData, {
            from: proxyAdminOwner,
          });
          const implementationAddress = await getAddressInSlot(this.proxy, ImplementationSlot);
          expect(implementationAddress).to.be.equal(this.implementationV2.address);
        });
      });
    });
  });
});
