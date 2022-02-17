const { BN, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');
const RLP = require('rlp');
const Enums = require('../../helpers/enums');
const GovernorHelper = require('../../helpers/governance');

const {
  shouldSupportInterfaces,
} = require('../../utils/introspection/SupportsInterface.behavior');

const Token = artifacts.require('ERC20VotesMock');
const Timelock = artifacts.require('CompTimelock');
const Governor = artifacts.require('GovernorTimelockCompoundMock');
const CallReceiver = artifacts.require('CallReceiverMock');

function makeContractAddress (creator, nonce) {
  return web3.utils.toChecksumAddress(web3.utils.sha3(RLP.encode([creator, nonce])).slice(12).substring(14));
}

contract('GovernorTimelockCompound', function (accounts) {
  const helper = new GovernorHelper();

  const [ owner, voter1, voter2, voter3, voter4, other ] = accounts;

  const name = 'OZ-Governor';
  // const version = '1';
  const tokenName = 'MockToken';
  const tokenSymbol = 'MTKN';
  const tokenSupply = web3.utils.toWei('100');
  const votingDelay = new BN(4);
  const votingPeriod = new BN(16);
  const value = web3.utils.toWei('1');

  beforeEach(async function () {
    const [ deployer ] = await web3.eth.getAccounts();

    this.token = await Token.new(tokenName, tokenSymbol);

    // Need to predict governance address to set it as timelock admin with a delayed transfer
    const nonce = await web3.eth.getTransactionCount(deployer);
    const predictGovernor = makeContractAddress(deployer, nonce + 1);

    this.timelock = await Timelock.new(predictGovernor, 2 * 86400);
    this.mock = await Governor.new(
      name,
      this.token.address,
      votingDelay,
      votingPeriod,
      this.timelock.address,
      0,
    );
    this.receiver = await CallReceiver.new();

    await web3.eth.sendTransaction({ from: owner, to: this.timelock.address, value });

    await this.token.mint(owner, tokenSupply);
    await this.token.delegate(voter1, { from: voter1 });
    await this.token.delegate(voter2, { from: voter2 });
    await this.token.delegate(voter3, { from: voter3 });
    await this.token.delegate(voter4, { from: voter4 });
    await this.token.transfer(voter1, web3.utils.toWei('10'), { from: owner });
    await this.token.transfer(voter2, web3.utils.toWei('7'), { from: owner });
    await this.token.transfer(voter3, web3.utils.toWei('5'), { from: owner });
    await this.token.transfer(voter4, web3.utils.toWei('2'), { from: owner });

    helper.setGovernor(this.mock);

    // default proposal
    this.details = helper.setProposal([
      [ this.receiver.address ],
      [ value ],
      [ this.receiver.contract.methods.mockFunction().encodeABI() ],
      '<proposal description>',
    ]);
  });

  shouldSupportInterfaces([
    'ERC165',
    'Governor',
    'GovernorTimelock',
  ]);

  it('doesn\'t accept ether transfers', async function () {
    await expectRevert.unspecified(web3.eth.sendTransaction({ from: owner, to: this.mock.address, value: 1 }));
  });

  it('post deployment check', async function () {
    expect(await this.mock.name()).to.be.equal(name);
    expect(await this.mock.token()).to.be.equal(this.token.address);
    expect(await this.mock.votingDelay()).to.be.bignumber.equal(votingDelay);
    expect(await this.mock.votingPeriod()).to.be.bignumber.equal(votingPeriod);
    expect(await this.mock.quorum(0)).to.be.bignumber.equal('0');

    expect(await this.mock.timelock()).to.be.equal(this.timelock.address);
    expect(await this.timelock.admin()).to.be.equal(this.mock.address);
  });

  it('nominal', async function () {
    await helper.propose();
    await helper.waitForSnapshot();
    await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
    await helper.vote({ support: Enums.VoteType.For }, { from: voter2 });
    await helper.vote({ support: Enums.VoteType.Against }, { from: voter3 });
    await helper.vote({ support: Enums.VoteType.Abstain }, { from: voter4 });
    await helper.waitForDeadline();
    const txQueue = await helper.queue();
    const eta = await this.mock.proposalEta(this.details.id);
    await helper.waitForEta();
    const txExecute = await helper.execute();

    expectEvent(txQueue, 'ProposalQueued', { proposalId: this.details.id });
    await expectEvent.inTransaction(txQueue.tx, this.timelock, 'QueueTransaction', { eta });

    expectEvent(txExecute, 'ProposalExecuted', { proposalId: this.details.id });
    await expectEvent.inTransaction(txExecute.tx, this.timelock, 'ExecuteTransaction', { eta });
    await expectEvent.inTransaction(txExecute.tx, this.receiver, 'MockFunctionCalled');
  });

  describe('should revert', function () {
    describe('on queue', function () {
      it('if already queued', async function () {
        await helper.propose();
        await helper.waitForSnapshot();
        await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await helper.waitForDeadline();
        await helper.queue();
        await expectRevert(helper.queue(), 'Governor: proposal not successful');
      });

      it('if proposal contains duplicate calls', async function () {
        helper.setProposal([
          Array(2).fill(this.token.address),
          Array(2).fill(web3.utils.toWei('0')),
          Array(2).fill(this.token.contract.methods.approve(this.receiver.address, constants.MAX_UINT256).encodeABI()),
          '<proposal description>',
        ]);

        await helper.propose();
        await helper.waitForSnapshot();
        await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await helper.waitForDeadline();
        await expectRevert(helper.queue(), 'GovernorTimelockCompound: identical proposal action already queued');
        await expectRevert(helper.execute(), 'GovernorTimelockCompound: proposal not yet queued');
      });
    });

    describe('on execute', function () {
      it('if not queued', async function () {
        await helper.propose();
        await helper.waitForSnapshot();
        await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await helper.waitForDeadline(+1);

        expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Succeeded);

        await expectRevert(helper.execute(), 'GovernorTimelockCompound: proposal not yet queued');
      });

      it('if too early', async function () {
        await helper.propose();
        await helper.waitForSnapshot();
        await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await helper.waitForDeadline();
        await helper.queue();

        expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Queued);

        await expectRevert(helper.execute(), 'Timelock::executeTransaction: Transaction hasn\'t surpassed time lock');
      });

      it('if too late', async function () {
        await helper.propose();
        await helper.waitForSnapshot();
        await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await helper.waitForDeadline();
        await helper.queue();
        await helper.waitForEta(+30 * 86400);

        expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Expired);

        await expectRevert(helper.execute(), 'Governor: proposal not successful');
      });

      it('if already executed', async function () {
        await helper.propose();
        await helper.waitForSnapshot();
        await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await helper.waitForDeadline();
        await helper.queue();
        await helper.waitForEta();
        await helper.execute();
        await expectRevert(helper.execute(), 'Governor: proposal not successful');
      });
    });
  });

  describe('cancel', function () {
    it('cancel before queue prevents scheduling', async function () {
      await helper.propose();
      await helper.waitForSnapshot();
      await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
      await helper.waitForDeadline();

      expectEvent(
        await helper.cancel(),
        'ProposalCanceled',
        { proposalId: this.details.id },
      );

      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Canceled);
      await expectRevert(helper.queue(), 'Governor: proposal not successful');
    });

    it('cancel after queue prevents executing', async function () {
      await helper.propose();
      await helper.waitForSnapshot();
      await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
      await helper.waitForDeadline();
      await helper.queue();

      expectEvent(
        await helper.cancel(),
        'ProposalCanceled',
        { proposalId: this.details.id },
      );

      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Canceled);
      await expectRevert(helper.execute(), 'Governor: proposal not successful');
    });
  });

  describe('onlyGovernance', function () {
    describe('relay', function () {
      beforeEach(async function () {
        await this.token.mint(this.mock.address, 1);
      });

      it('is protected', async function () {
        await expectRevert(
          this.mock.relay(
            this.token.address,
            0,
            this.token.contract.methods.transfer(other, 1).encodeABI(),
          ),
          'Governor: onlyGovernance',
        );
      });

      it('can be executed through governance', async function () {
        helper.setProposal([
          [ this.mock.address ],
          [ web3.utils.toWei('0') ],
          [
            this.mock.contract.methods.relay(
              this.token.address,
              0,
              this.token.contract.methods.transfer(other, 1).encodeABI(),
            ).encodeABI(),
          ],
          '<proposal description>',
        ]);

        expect(await this.token.balanceOf(this.mock.address), 1);
        expect(await this.token.balanceOf(other), 0);

        await helper.propose();
        await helper.waitForSnapshot();
        await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await helper.waitForDeadline();
        await helper.queue();
        await helper.waitForEta();
        const txExecute = await helper.execute();

        expect(await this.token.balanceOf(this.mock.address), 0);
        expect(await this.token.balanceOf(other), 1);

        expectEvent.inTransaction(
          txExecute.tx,
          this.token,
          'Transfer',
          { from: this.mock.address, to: other, value: '1' },
        );
      });
    });

    describe('updateTimelock', function () {
      beforeEach(async function () {
        this.newTimelock = await Timelock.new(this.mock.address, 7 * 86400);
      });

      it('is protected', async function () {
        await expectRevert(
          this.mock.updateTimelock(this.newTimelock.address),
          'Governor: onlyGovernance',
        );
      });

      it('can be executed through governance to', async function () {
        helper.setProposal([
          [
            this.timelock.address,
            this.mock.address,
          ],
          [
            web3.utils.toWei('0'),
            web3.utils.toWei('0'),
          ],
          [
            this.timelock.contract.methods.setPendingAdmin(owner).encodeABI(),
            this.mock.contract.methods.updateTimelock(this.newTimelock.address).encodeABI(),
          ],
          '<proposal description>',
        ]);

        await helper.propose();
        await helper.waitForSnapshot();
        await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await helper.waitForDeadline();
        await helper.queue();
        await helper.waitForEta();
        const txExecute = await helper.execute();

        expectEvent(
          txExecute,
          'TimelockChange',
          { oldTimelock: this.timelock.address, newTimelock: this.newTimelock.address },
        );

        expect(await this.mock.timelock()).to.be.bignumber.equal(this.newTimelock.address);
      });
    });

    it('can transfer timelock to new governor', async function () {
      const newGovernor = await Governor.new(name, this.token.address, 8, 32, this.timelock.address, 0);

      helper.setProposal([
        [ this.timelock.address ],
        [ web3.utils.toWei('0') ],
        [ this.timelock.contract.methods.setPendingAdmin(newGovernor.address).encodeABI() ],
        '<proposal description>',
      ]);

      await helper.propose();
      await helper.waitForSnapshot();
      await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
      await helper.waitForDeadline();
      await helper.queue();
      await helper.waitForEta();
      const txExecute = await helper.execute();

      await expectEvent.inTransaction(
        txExecute.tx,
        this.timelock,
        'NewPendingAdmin',
        { newPendingAdmin: newGovernor.address },
      );

      await newGovernor.__acceptAdmin();
      expect(await this.timelock.admin()).to.be.bignumber.equal(newGovernor.address);
    });
  });
});
