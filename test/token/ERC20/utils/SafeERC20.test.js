const { ethers } = require('hardhat');
const { expect } = require('chai');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

const name = 'ERC20Mock';
const symbol = 'ERC20Mock';

async function fixture() {
  const [hasNoCode, owner, receiver, spender] = await ethers.getSigners();

  const mock = await ethers.deployContract('$SafeERC20');
  const erc20ReturnFalseMock = await ethers.deployContract('$ERC20ReturnFalseMock', [name, symbol]);
  const erc20ReturnTrueMock = await ethers.deployContract('$ERC20', [name, symbol]); // default implementation returns true
  const erc20NoReturnMock = await ethers.deployContract('$ERC20NoReturnMock', [name, symbol]);
  const erc20ForceApproveMock = await ethers.deployContract('$ERC20ForceApproveMock', [name, symbol]);

  return {
    hasNoCode,
    owner,
    receiver,
    spender,
    mock,
    erc20ReturnFalseMock,
    erc20ReturnTrueMock,
    erc20NoReturnMock,
    erc20ForceApproveMock,
  };
}

describe('SafeERC20', function () {
  before(async function () {
    Object.assign(this, await loadFixture(fixture));
  });

  describe('with address that has no contract code', function () {
    beforeEach(async function () {
      this.token = this.hasNoCode;
    });

    it('reverts on transfer', async function () {
      await expect(this.mock.$safeTransfer(this.token, this.receiver, 0n))
        .to.be.revertedWithCustomError(this.mock, 'AddressEmptyCode')
        .withArgs(this.token);
    });

    it('reverts on transferFrom', async function () {
      await expect(this.mock.$safeTransferFrom(this.token, this.mock, this.receiver, 0n))
        .to.be.revertedWithCustomError(this.mock, 'AddressEmptyCode')
        .withArgs(this.token);
    });

    it('reverts on increaseAllowance', async function () {
      // Call to 'token.allowance' does not return any data, resulting in a decoding error (revert without reason)
      await expect(this.mock.$safeIncreaseAllowance(this.token, this.spender, 0n)).to.be.revertedWithoutReason();
    });

    it('reverts on decreaseAllowance', async function () {
      // Call to 'token.allowance' does not return any data, resulting in a decoding error (revert without reason)
      await expect(this.mock.$safeDecreaseAllowance(this.token, this.spender, 0n)).to.be.revertedWithoutReason();
    });

    it('reverts on forceApprove', async function () {
      await expect(this.mock.$forceApprove(this.token, this.spender, 0n))
        .to.be.revertedWithCustomError(this.mock, 'AddressEmptyCode')
        .withArgs(this.token);
    });
  });

  describe('with token that returns false on all calls', function () {
    beforeEach(async function () {
      this.token = this.erc20ReturnFalseMock;
    });

    it('reverts on transfer', async function () {
      await expect(this.mock.$safeTransfer(this.token, this.receiver, 0n))
        .to.be.revertedWithCustomError(this.mock, 'SafeERC20FailedOperation')
        .withArgs(this.token);
    });

    it('reverts on transferFrom', async function () {
      await expect(this.mock.$safeTransferFrom(this.token, this.mock, this.receiver, 0n))
        .to.be.revertedWithCustomError(this.mock, 'SafeERC20FailedOperation')
        .withArgs(this.token);
    });

    it('reverts on increaseAllowance', async function () {
      await expect(this.mock.$safeIncreaseAllowance(this.token, this.spender, 0n))
        .to.be.revertedWithCustomError(this.mock, 'SafeERC20FailedOperation')
        .withArgs(this.token);
    });

    it('reverts on decreaseAllowance', async function () {
      await expect(this.mock.$safeDecreaseAllowance(this.token, this.spender, 0n))
        .to.be.revertedWithCustomError(this.mock, 'SafeERC20FailedOperation')
        .withArgs(this.token);
    });

    it('reverts on forceApprove', async function () {
      await expect(this.mock.$forceApprove(this.token, this.spender, 0n))
        .to.be.revertedWithCustomError(this.mock, 'SafeERC20FailedOperation')
        .withArgs(this.token);
    });
  });

  describe('with token that returns true on all calls', function () {
    beforeEach(async function () {
      this.token = this.erc20ReturnTrueMock;
    });

    shouldOnlyRevertOnErrors();
  });

  describe('with token that returns no boolean values', function () {
    beforeEach(async function () {
      this.token = this.erc20NoReturnMock;
    });

    shouldOnlyRevertOnErrors();
  });

  describe('with usdt approval beaviour', function () {
    beforeEach(async function () {
      this.token = this.erc20ForceApproveMock;
    });

    describe('with initial approval', function () {
      beforeEach(async function () {
        await this.token.$_approve(this.mock, this.spender, 100n);
      });

      it('safeIncreaseAllowance works', async function () {
        await this.mock.$safeIncreaseAllowance(this.token, this.spender, 10n);
        expect(await this.token.allowance(this.mock, this.spender)).to.equal(110n);
      });

      it('safeDecreaseAllowance works', async function () {
        await this.mock.$safeDecreaseAllowance(this.token, this.spender, 10n);
        expect(await this.token.allowance(this.mock, this.spender)).to.equal(90n);
      });

      it('forceApprove works', async function () {
        await this.mock.$forceApprove(this.token, this.spender, 200n);
        expect(await this.token.allowance(this.mock, this.spender)).to.equal(200n);
      });
    });
  });

  describe('with ERC1363', function () {
    const value = web3.utils.toBN(100);
    const data = '0x12345678';

    beforeEach(async function () {
      this.token = await ERC1363.new(name, symbol);
    });

    shouldOnlyRevertOnErrors(accounts);

    describe('transferAndCall', function () {
      it('cannot transferAndCall to an EOA directly', async function () {
        await this.token.$_mint(owner, 100);

        await expectRevertCustomError(
          this.token.methods['transferAndCall(address,uint256,bytes)'](receiver, value, data, { from: owner }),
          'ERC1363InvalidReceiver',
          [receiver],
        );
      });

      it('can transferAndCall to an EOA using helper', async function () {
        await this.token.$_mint(this.mock.address, value);

        const { tx } = await this.mock.$transferAndCallRelaxed(this.token.address, receiver, value, data);
        await expectEvent.inTransaction(tx, this.token, 'Transfer', {
          from: this.mock.address,
          to: receiver,
          value,
        });
      });

      it('can transferAndCall to an ERC1363Receiver using helper', async function () {
        const receiver = await ERC1363ReceiverMock.new();

        await this.token.$_mint(this.mock.address, value);

        const { tx } = await this.mock.$transferAndCallRelaxed(this.token.address, receiver.address, value, data);
        await expectEvent.inTransaction(tx, this.token, 'Transfer', {
          from: this.mock.address,
          to: receiver.address,
          value,
        });
        await expectEvent.inTransaction(tx, receiver, 'Received', {
          operator: this.mock.address,
          from: this.mock.address,
          value,
          data,
        });
      });
    });

    describe('transferFromAndCall', function () {
      it('cannot transferFromAndCall to an EOA directly', async function () {
        await this.token.$_mint(owner, value);
        await this.token.approve(other, constants.MAX_UINT256, { from: owner });

        await expectRevertCustomError(
          this.token.methods['transferFromAndCall(address,address,uint256,bytes)'](owner, receiver, value, data, {
            from: other,
          }),
          'ERC1363InvalidReceiver',
          [receiver],
        );
      });

      it('can transferFromAndCall to an EOA using helper', async function () {
        await this.token.$_mint(owner, value);
        await this.token.approve(this.mock.address, constants.MAX_UINT256, { from: owner });

        const { tx } = await this.mock.$transferFromAndCallRelaxed(this.token.address, owner, receiver, value, data);
        await expectEvent.inTransaction(tx, this.token, 'Transfer', {
          from: owner,
          to: receiver,
          value,
        });
      });

      it('can transferFromAndCall to an ERC1363Receiver using helper', async function () {
        const receiver = await ERC1363ReceiverMock.new();

        await this.token.$_mint(owner, value);
        await this.token.approve(this.mock.address, constants.MAX_UINT256, { from: owner });

        const { tx } = await this.mock.$transferFromAndCallRelaxed(
          this.token.address,
          owner,
          receiver.address,
          value,
          data,
        );
        await expectEvent.inTransaction(tx, this.token, 'Transfer', {
          from: owner,
          to: receiver.address,
          value,
        });
        await expectEvent.inTransaction(tx, receiver, 'Received', {
          operator: this.mock.address,
          from: owner,
          value,
          data,
        });
      });
    });

    describe('approveAndCall', function () {
      it('cannot approveAndCall to an EOA directly', async function () {
        await expectRevertCustomError(
          this.token.methods['approveAndCall(address,uint256,bytes)'](receiver, value, data),
          'ERC1363InvalidSpender',
          [receiver],
        );
      });

      it('can approveAndCall to an EOA using helper', async function () {
        const { tx } = await this.mock.$approveAndCallRelaxed(this.token.address, receiver, value, data);
        await expectEvent.inTransaction(tx, this.token, 'Approval', {
          owner: this.mock.address,
          spender: receiver,
          value,
        });
      });

      it('can approveAndCall to an ERC1363Spender using helper', async function () {
        const spender = await ERC1363SpenderMock.new();

        const { tx } = await this.mock.$approveAndCallRelaxed(this.token.address, spender.address, value, data);
        await expectEvent.inTransaction(tx, this.token, 'Approval', {
          owner: this.mock.address,
          spender: spender.address,
          value,
        });
        await expectEvent.inTransaction(tx, spender, 'Approved', {
          owner: this.mock.address,
          value,
          data,
        });
      });
    });
  });
});

function shouldOnlyRevertOnErrors() {
  describe('transfers', function () {
    beforeEach(async function () {
      await this.token.$_mint(this.owner, 100n);
      await this.token.$_mint(this.mock, 100n);
      await this.token.$_approve(this.owner, this.mock, ethers.MaxUint256);
    });

    it("doesn't revert on transfer", async function () {
      await expect(this.mock.$safeTransfer(this.token, this.receiver, 10n))
        .to.emit(this.token, 'Transfer')
        .withArgs(this.mock, this.receiver, 10n);
    });

    it("doesn't revert on transferFrom", async function () {
      await expect(this.mock.$safeTransferFrom(this.token, this.owner, this.receiver, 10n))
        .to.emit(this.token, 'Transfer')
        .withArgs(this.owner, this.receiver, 10n);
    });
  });

  describe('approvals', function () {
    context('with zero allowance', function () {
      beforeEach(async function () {
        await this.token.$_approve(this.mock, this.spender, 0n);
      });

      it("doesn't revert when force approving a non-zero allowance", async function () {
        await this.mock.$forceApprove(this.token, this.spender, 100n);
        expect(await this.token.allowance(this.mock, this.spender)).to.equal(100n);
      });

      it("doesn't revert when force approving a zero allowance", async function () {
        await this.mock.$forceApprove(this.token, this.spender, 0n);
        expect(await this.token.allowance(this.mock, this.spender)).to.equal(0n);
      });

      it("doesn't revert when increasing the allowance", async function () {
        await this.mock.$safeIncreaseAllowance(this.token, this.spender, 10n);
        expect(await this.token.allowance(this.mock, this.spender)).to.equal(10n);
      });

      it('reverts when decreasing the allowance', async function () {
        await expect(this.mock.$safeDecreaseAllowance(this.token, this.spender, 10n))
          .to.be.revertedWithCustomError(this.mock, 'SafeERC20FailedDecreaseAllowance')
          .withArgs(this.spender, 0n, 10n);
      });
    });

    context('with non-zero allowance', function () {
      beforeEach(async function () {
        await this.token.$_approve(this.mock, this.spender, 100n);
      });

      it("doesn't revert when force approving a non-zero allowance", async function () {
        await this.mock.$forceApprove(this.token, this.spender, 20n);
        expect(await this.token.allowance(this.mock, this.spender)).to.equal(20n);
      });

      it("doesn't revert when force approving a zero allowance", async function () {
        await this.mock.$forceApprove(this.token, this.spender, 0n);
        expect(await this.token.allowance(this.mock, this.spender)).to.equal(0n);
      });

      it("doesn't revert when increasing the allowance", async function () {
        await this.mock.$safeIncreaseAllowance(this.token, this.spender, 10n);
        expect(await this.token.allowance(this.mock, this.spender)).to.equal(110n);
      });

      it("doesn't revert when decreasing the allowance to a positive value", async function () {
        await this.mock.$safeDecreaseAllowance(this.token, this.spender, 50n);
        expect(await this.token.allowance(this.mock, this.spender)).to.equal(50n);
      });

      it('reverts when decreasing the allowance to a negative value', async function () {
        await expect(this.mock.$safeDecreaseAllowance(this.token, this.spender, 200n))
          .to.be.revertedWithCustomError(this.mock, 'SafeERC20FailedDecreaseAllowance')
          .withArgs(this.spender, 100n, 200n);
      });
    });
  });
}
