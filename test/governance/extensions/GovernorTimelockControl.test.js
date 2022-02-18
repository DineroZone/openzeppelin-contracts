const { BN, constants, expectEvent, expectRevert, time } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');
const Enums = require('../../helpers/enums');
const GovernorHelper = require('../../helpers/governance');

const {
  shouldSupportInterfaces,
} = require('../../utils/introspection/SupportsInterface.behavior');

const Token = artifacts.require('ERC20VotesMock');
const Timelock = artifacts.require('TimelockController');
const Governor = artifacts.require('GovernorTimelockControlMock');
const CallReceiver = artifacts.require('CallReceiverMock');

contract('GovernorTimelockControl', function (accounts) {
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
    this.timelock = await Timelock.new(3600, [], []);
    this.mock = await Governor.new(
      name,
      this.token.address,
      votingDelay,
      votingPeriod,
      this.timelock.address,
      0,
    );
    this.receiver = await CallReceiver.new();

    GovernorHelper.resert();
    GovernorHelper.setup(this.mock);

    await web3.eth.sendTransaction({ from: owner, to: this.timelock.address, value });

    // normal setup: governor and admin are proposers, everyone is executor, timelock is its own admin
    await this.timelock.grantRole(await this.timelock.PROPOSER_ROLE(), this.mock.address);
    await this.timelock.grantRole(await this.timelock.PROPOSER_ROLE(), owner);
    await this.timelock.grantRole(await this.timelock.EXECUTOR_ROLE(), constants.ZERO_ADDRESS);
    await this.timelock.revokeRole(await this.timelock.TIMELOCK_ADMIN_ROLE(), deployer);

    await this.token.mint(owner, tokenSupply);
    await GovernorHelper.delegate({ token: this.token, to: voter1, value: web3.utils.toWei('10') }, { from: owner });
    await GovernorHelper.delegate({ token: this.token, to: voter2, value: web3.utils.toWei('7') }, { from: owner });
    await GovernorHelper.delegate({ token: this.token, to: voter3, value: web3.utils.toWei('5') }, { from: owner });
    await GovernorHelper.delegate({ token: this.token, to: voter4, value: web3.utils.toWei('2') }, { from: owner });

    // default proposal
    this.details = GovernorHelper.setProposal([
      [ this.receiver.address ],
      [ value ],
      [ this.receiver.contract.methods.mockFunction().encodeABI() ],
      '<proposal description>',
    ]);
    this.details.timelockid = await this.timelock.hashOperationBatch(
      ...this.details.shortProposal.slice(0, 3),
      '0x0',
      this.details.shortProposal[3],
    );
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
  });

  it('nominal', async function () {
    await GovernorHelper.propose();
    await GovernorHelper.waitForSnapshot();
    await GovernorHelper.vote({ support: Enums.VoteType.For }, { from: voter1 });
    await GovernorHelper.vote({ support: Enums.VoteType.For }, { from: voter2 });
    await GovernorHelper.vote({ support: Enums.VoteType.Against }, { from: voter3 });
    await GovernorHelper.vote({ support: Enums.VoteType.Abstain }, { from: voter4 });
    await GovernorHelper.waitForDeadline();
    const txQueue = await GovernorHelper.queue();
    await GovernorHelper.waitForEta();
    const txExecute = await GovernorHelper.execute();

    expectEvent(txQueue, 'ProposalQueued', { proposalId: this.details.id });
    await expectEvent.inTransaction(txQueue.tx, this.timelock, 'CallScheduled', { id: this.details.timelockid });

    expectEvent(txExecute, 'ProposalExecuted', { proposalId: this.details.id });
    await expectEvent.inTransaction(txExecute.tx, this.timelock, 'CallExecuted', { id: this.details.timelockid });
    await expectEvent.inTransaction(txExecute.tx, this.receiver, 'MockFunctionCalled');
  });

  describe('should revert', function () {
    describe('on queue', function () {
      it('if already queued', async function () {
        await GovernorHelper.propose();
        await GovernorHelper.waitForSnapshot();
        await GovernorHelper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await GovernorHelper.waitForDeadline();
        await GovernorHelper.queue();
        await expectRevert(GovernorHelper.queue(), 'Governor: proposal not successful');
      });
    });

    describe('on execute', function () {
      it('if not queued', async function () {
        await GovernorHelper.propose();
        await GovernorHelper.waitForSnapshot();
        await GovernorHelper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await GovernorHelper.waitForDeadline(+1);

        expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Succeeded);

        await expectRevert(GovernorHelper.execute(), 'TimelockController: operation is not ready');
      });

      it('if too early', async function () {
        await GovernorHelper.propose();
        await GovernorHelper.waitForSnapshot();
        await GovernorHelper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await GovernorHelper.waitForDeadline();
        await GovernorHelper.queue();

        expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Queued);

        await expectRevert(GovernorHelper.execute(), 'TimelockController: operation is not ready');
      });

      it('if already executed', async function () {
        await GovernorHelper.propose();
        await GovernorHelper.waitForSnapshot();
        await GovernorHelper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await GovernorHelper.waitForDeadline();
        await GovernorHelper.queue();
        await GovernorHelper.waitForEta();
        await GovernorHelper.execute();
        await expectRevert(GovernorHelper.execute(), 'Governor: proposal not successful');
      });

      it('if already executed by another proposer', async function () {
        await GovernorHelper.propose();
        await GovernorHelper.waitForSnapshot();
        await GovernorHelper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await GovernorHelper.waitForDeadline();
        await GovernorHelper.queue();
        await GovernorHelper.waitForEta();

        await this.timelock.executeBatch(
          ...this.details.shortProposal.slice(0, 3),
          '0x0',
          this.details.shortProposal[3],
        );

        await expectRevert(GovernorHelper.execute(), 'Governor: proposal not successful');
      });
    });
  });

  describe('cancel', function () {
    it('cancel before queue prevents scheduling', async function () {
      await GovernorHelper.propose();
      await GovernorHelper.waitForSnapshot();
      await GovernorHelper.vote({ support: Enums.VoteType.For }, { from: voter1 });
      await GovernorHelper.waitForDeadline();

      expectEvent(
        await GovernorHelper.cancel(),
        'ProposalCanceled',
        { proposalId: this.details.id },
      );

      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Canceled);
      await expectRevert(GovernorHelper.queue(), 'Governor: proposal not successful');
    });

    it('cancel after queue prevents executing', async function () {
      await GovernorHelper.propose();
      await GovernorHelper.waitForSnapshot();
      await GovernorHelper.vote({ support: Enums.VoteType.For }, { from: voter1 });
      await GovernorHelper.waitForDeadline();
      await GovernorHelper.queue();

      expectEvent(
        await GovernorHelper.cancel(),
        'ProposalCanceled',
        { proposalId: this.details.id },
      );

      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Canceled);
      await expectRevert(GovernorHelper.execute(), 'Governor: proposal not successful');
    });

    it('cancel on timelock is reflected on governor', async function () {
      await GovernorHelper.propose();
      await GovernorHelper.waitForSnapshot();
      await GovernorHelper.vote({ support: Enums.VoteType.For }, { from: voter1 });
      await GovernorHelper.waitForDeadline();
      await GovernorHelper.queue();

      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Queued);

      expectEvent(
        await this.timelock.cancel(this.details.timelockid, { from: owner }),
        'Cancelled',
        { id: this.details.timelockid },
      );

      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Canceled);
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
        GovernorHelper.setProposal([
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

        await GovernorHelper.propose();
        await GovernorHelper.waitForSnapshot();
        await GovernorHelper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await GovernorHelper.waitForDeadline();
        await GovernorHelper.queue();
        await GovernorHelper.waitForEta();
        const txExecute = await GovernorHelper.execute();

        expect(await this.token.balanceOf(this.mock.address), 0);
        expect(await this.token.balanceOf(other), 1);

        expectEvent.inTransaction(
          txExecute.tx,
          this.token,
          'Transfer',
          { from: this.mock.address, to: other, value: '1' },
        );
      });

      it('protected against other proposers', async function () {
        await this.timelock.schedule(
          this.mock.address,
          web3.utils.toWei('0'),
          this.mock.contract.methods.relay(constants.ZERO_ADDRESS, 0, '0x').encodeABI(),
          constants.ZERO_BYTES32,
          constants.ZERO_BYTES32,
          3600,
          { from: owner },
        );

        await time.increase(3600);

        await expectRevert(
          this.timelock.execute(
            this.mock.address,
            web3.utils.toWei('0'),
            this.mock.contract.methods.relay(constants.ZERO_ADDRESS, 0, '0x').encodeABI(),
            constants.ZERO_BYTES32,
            constants.ZERO_BYTES32,
            { from: owner },
          ),
          'TimelockController: underlying transaction reverted',
        );
      });
    });

    describe('updateTimelock', function () {
      beforeEach(async function () {
        this.newTimelock = await Timelock.new(3600, [], []);
      });

      it('is protected', async function () {
        await expectRevert(
          this.mock.updateTimelock(this.newTimelock.address),
          'Governor: onlyGovernance',
        );
      });

      it('can be executed through governance to', async function () {
        GovernorHelper.setProposal([
          [ this.mock.address ],
          [ web3.utils.toWei('0') ],
          [ this.mock.contract.methods.updateTimelock(this.newTimelock.address).encodeABI() ],
          '<proposal description>',
        ]);

        await GovernorHelper.propose();
        await GovernorHelper.waitForSnapshot();
        await GovernorHelper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await GovernorHelper.waitForDeadline();
        await GovernorHelper.queue();
        await GovernorHelper.waitForEta();
        const txExecute = await GovernorHelper.execute();

        expectEvent(
          txExecute,
          'TimelockChange',
          { oldTimelock: this.timelock.address, newTimelock: this.newTimelock.address },
        );

        expect(await this.mock.timelock()).to.be.bignumber.equal(this.newTimelock.address);
      });
    });
  });

  it('clear queue of pending governor calls', async function () {
    GovernorHelper.setProposal([
      [ this.mock.address ],
      [ web3.utils.toWei('0') ],
      [ this.mock.contract.methods.nonGovernanceFunction().encodeABI() ],
      '<proposal description>',
    ]);

    await GovernorHelper.propose();
    await GovernorHelper.waitForSnapshot();
    await GovernorHelper.vote({ support: Enums.VoteType.For }, { from: voter1 });
    await GovernorHelper.waitForDeadline();
    await GovernorHelper.queue();
    await GovernorHelper.waitForEta();
    await GovernorHelper.execute();

    // TODO: check that _governanceCall is empty.
  });
});
