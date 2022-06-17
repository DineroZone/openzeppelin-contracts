const { BN, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { shouldSupportInterfaces } = require('../../../utils/introspection/SupportsInterface.behavior');

const ERC1363Mock = artifacts.require('ERC1363Mock');
const ERC1363ReceiverMock = artifacts.require('ERC1363ReceiverMock');

contract('ERC1363', function (accounts) {
  const [ holder, operator, other ] = accounts;

  const initialSupply = new BN(100);
  const value = new BN(10);

  const name = 'My Token';
  const symbol = 'MTKN';

  beforeEach(async function () {
    this.token = await ERC1363Mock.new(name, symbol, holder, initialSupply);
    this.receiver = await ERC1363ReceiverMock.new();
  });

  shouldSupportInterfaces([
    'ERC165',
    'ERC1363',
  ]);

  describe('transferAndCall', function () {
    it('to EOA', async function () {
      await expectRevert(
        this.token.methods['transferAndCall(address,uint256)'](
          other,
          value,
          { from: holder },
        ),
        'function call to a non-contract account',
      );
    });

    describe('to receiver', function () {
      it('without data', async function () {
        this.function = 'transferAndCall(address,uint256)';
        this.operator = holder;
      });

      it('with data', async function () {
        this.function = 'transferAndCall(address,uint256,bytes)';
        this.data = '0x123456';
        this.operator = holder;
      });

      it('invalid return value', async function () {
        this.function = 'transferAndCall(address,uint256,bytes)';
        this.data = '0x00';
        this.operator = holder;
        this.revert = 'ERC1363: transfer to non ERC1363Receiver implementer';
      });

      it('hook reverts with message', async function () {
        this.function = 'transferAndCall(address,uint256,bytes)';
        this.data = '0x01';
        this.operator = holder;
        this.revert = 'onTransferReceived revert';
      });

      it('hook reverts without message', async function () {
        this.function = 'transferAndCall(address,uint256,bytes)';
        this.data = '0x02';
        this.operator = holder;
        this.revert = 'ERC1363: transfer to non ERC1363Receiver implementer';
      });

      it('hook reverts with assert(false)', async function () {
        this.function = 'transferAndCall(address,uint256,bytes)';
        this.data = '0x03';
        this.operator = holder;
        this.revert = 'reverted with panic code 0x1 (Assertion error)';
      });

      afterEach(async function () {
        const txPromise = this.token.methods[this.function](...[
          this.receiver.address,
          value,
          this.data,
          { from: this.operator },
        ].filter(Boolean));

        if (this.revert === undefined) {
          const { tx } = await txPromise;
          await expectEvent.inTransaction(tx, this.token, 'Transfer', {
            from: this.from || this.operator,
            to: this.receiver.address,
            value,
          });
          await expectEvent.inTransaction(tx, this.receiver, 'TransferReceived', {
            operator: this.operator,
            from: this.from || this.operator,
            value,
            data: this.data || null,
          });
        } else {
          await expectRevert(txPromise, this.revert);
        }
      });
    });
  });

  describe('transferFromAndCall', function () {
    beforeEach(async function () {
      await this.token.approve(operator, initialSupply, { from: holder });
    });

    it('to EOA', async function () {
      await expectRevert(
        this.token.methods['transferFromAndCall(address,address,uint256)'](
          holder,
          other,
          value,
          { from: operator },
        ),
        'function call to a non-contract account',
      );
    });

    describe('to receiver', function () {
      it('without data', async function () {
        this.function = 'transferFromAndCall(address,address,uint256)';
        this.from = holder;
        this.operator = operator;
      });

      it('with data', async function () {
        this.function = 'transferFromAndCall(address,address,uint256,bytes)';
        this.data = '0x123456';
        this.from = holder;
        this.operator = operator;
      });

      it('invalid return value', async function () {
        this.function = 'transferFromAndCall(address,address,uint256,bytes)';
        this.data = '0x00';
        this.from = holder;
        this.operator = operator;
        this.revert = 'ERC1363: transfer to non ERC1363Receiver implementer';
      });

      it('hook reverts with message', async function () {
        this.function = 'transferFromAndCall(address,address,uint256,bytes)';
        this.data = '0x01';
        this.from = holder;
        this.operator = operator;
        this.revert = 'onTransferReceived revert';
      });

      it('hook reverts without message', async function () {
        this.function = 'transferFromAndCall(address,address,uint256,bytes)';
        this.data = '0x02';
        this.from = holder;
        this.operator = operator;
        this.revert = 'ERC1363: transfer to non ERC1363Receiver implementer';
      });

      it('hook reverts with assert(false)', async function () {
        this.function = 'transferFromAndCall(address,address,uint256,bytes)';
        this.data = '0x03';
        this.operator = holder;
        this.operator = operator;
        this.revert = 'reverted with panic code 0x1 (Assertion error)';
      });

      afterEach(async function () {
        const txPromise = this.token.methods[this.function](...[
          this.from,
          this.receiver.address,
          value,
          this.data,
          { from: this.operator },
        ].filter(Boolean));

        if (this.revert === undefined) {
          const { tx } = await txPromise;
          await expectEvent.inTransaction(tx, this.token, 'Transfer', {
            from: this.from || this.operator,
            to: this.receiver.address,
            value,
          });
          await expectEvent.inTransaction(tx, this.receiver, 'TransferReceived', {
            operator: this.operator,
            from: this.from || this.operator,
            value,
            data: this.data || null,
          });
        } else {
          await expectRevert(txPromise, this.revert);
        }
      });
    });
  });

  describe('approveAndCall', function () {
    it('to EOA', async function () {
      await expectRevert(
        this.token.methods['approveAndCall(address,uint256)'](other, value, { from: holder }),
        'function call to a non-contract account',
      );
    });

    describe('to receiver', function () {
      it('without data', async function () {
        this.function = 'approveAndCall(address,uint256)';
        this.owner = holder;
      });

      it('with data', async function () {
        this.function = 'approveAndCall(address,uint256,bytes)';
        this.data = '0x123456';
        this.owner = holder;
      });

      it('invalid return value', async function () {
        this.function = 'approveAndCall(address,uint256,bytes)';
        this.data = '0x00';
        this.owner = holder;
        this.revert = 'ERC1363: transfer to non ERC1363Spender implementer';
      });

      it('hook reverts with message', async function () {
        this.function = 'approveAndCall(address,uint256,bytes)';
        this.data = '0x01';
        this.owner = holder;
        this.revert = 'onApprovalReceived revert';
      });

      it('hook reverts without message', async function () {
        this.function = 'approveAndCall(address,uint256,bytes)';
        this.data = '0x02';
        this.owner = holder;
        this.revert = 'ERC1363: transfer to non ERC1363Spender implementer';
      });

      it('hook reverts with assert(false)', async function () {
        this.function = 'approveAndCall(address,uint256,bytes)';
        this.data = '0x03';
        this.operator = holder;
        this.revert = 'reverted with panic code 0x1 (Assertion error)';
      });

      afterEach(async function () {
        const txPromise = this.token.methods[this.function](...[
          this.receiver.address,
          value,
          this.data,
          { from: this.owner },
        ].filter(Boolean));

        if (this.revert === undefined) {
          const { tx } = await txPromise;

          await expectEvent.inTransaction(tx, this.token, 'Approval', {
            owner: this.owner,
            spender: this.receiver.address,
            value,
          });
          await expectEvent.inTransaction(tx, this.receiver, 'ApprovalReceived', {
            owner: this.owner,
            value,
            data: this.data || null,
          });
        } else {
          await expectRevert(txPromise, this.revert);
        }
      });
    });
  });
});
