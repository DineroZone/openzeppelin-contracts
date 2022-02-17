const { BN, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');
const ethSigUtil = require('eth-sig-util');
const Wallet = require('ethereumjs-wallet').default;
const { fromRpcSig } = require('ethereumjs-util');
const Enums = require('../helpers/enums');
const { EIP712Domain } = require('../helpers/eip712');
const GovernorHelper = require('../helpers/governance');

const {
  shouldSupportInterfaces,
} = require('../utils/introspection/SupportsInterface.behavior');

const Token = artifacts.require('ERC20VotesMock');
const Governor = artifacts.require('GovernorMock');
const CallReceiver = artifacts.require('CallReceiverMock');

contract('Governor', function (accounts) {
  const helper = new GovernorHelper();

  const [ owner, proposer, voter1, voter2, voter3, voter4 ] = accounts;
  const empty = web3.utils.toChecksumAddress(web3.utils.randomHex(20));

  const name = 'OZ-Governor';
  const version = '1';
  const tokenName = 'MockToken';
  const tokenSymbol = 'MTKN';
  const tokenSupply = web3.utils.toWei('100');
  const votingDelay = new BN(4);
  const votingPeriod = new BN(16);
  const value = web3.utils.toWei('1');

  beforeEach(async function () {
    this.chainId = await web3.eth.getChainId();
    this.token = await Token.new(tokenName, tokenSymbol);
    this.mock = await Governor.new(name, this.token.address, votingDelay, votingPeriod, 10);
    this.receiver = await CallReceiver.new();

    await web3.eth.sendTransaction({ from: owner, to: this.mock.address, value });

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
  ]);

  it('deployment check', async function () {
    expect(await this.mock.name()).to.be.equal(name);
    expect(await this.mock.token()).to.be.equal(this.token.address);
    expect(await this.mock.votingDelay()).to.be.bignumber.equal(votingDelay);
    expect(await this.mock.votingPeriod()).to.be.bignumber.equal(votingPeriod);
    expect(await this.mock.quorum(0)).to.be.bignumber.equal('0');
    expect(await this.mock.COUNTING_MODE()).to.be.equal('support=bravo&quorum=for,abstain');
  });

  it('nominal workflow', async function () {
    // Before
    expect(await web3.eth.getBalance(this.mock.address)).to.be.bignumber.equal(value);
    expect(await web3.eth.getBalance(this.receiver.address)).to.be.bignumber.equal('0');

    // Run proposal
    const txPropose = await helper.propose({ from: proposer });

    expectEvent(
      txPropose,
      'ProposalCreated',
      {
        proposalId: this.details.id,
        proposer,
        targets: this.details.shortProposal[0],
        // values: shortProposal[1],
        signatures: this.details.shortProposal[2].map(() => ''),
        calldatas: this.details.shortProposal[2],
        startBlock: new BN(txPropose.receipt.blockNumber).add(votingDelay),
        endBlock: new BN(txPropose.receipt.blockNumber).add(votingDelay).add(votingPeriod),
        description: this.details.proposal.last(),
      },
    );

    await helper.waitForSnapshot();

    expectEvent(
      await helper.vote({ support: Enums.VoteType.For, reason: 'This is nice' }, { from: voter1 }),
      'VoteCast',
      {
        voter: voter1,
        support: Enums.VoteType.For,
        reason: 'This is nice',
        weight: web3.utils.toWei('10'),
      },
    );

    expectEvent(
      await helper.vote({ support: Enums.VoteType.For }, { from: voter2 }),
      'VoteCast',
      {
        voter: voter2,
        support: Enums.VoteType.For,
        weight: web3.utils.toWei('7'),
      },
    );

    expectEvent(
      await helper.vote({ support: Enums.VoteType.Against }, { from: voter3 }),
      'VoteCast',
      {
        voter: voter3,
        support: Enums.VoteType.Against,
        weight: web3.utils.toWei('5'),
      },
    );

    expectEvent(
      await helper.vote({ support: Enums.VoteType.Abstain }, { from: voter4 }),
      'VoteCast',
      {
        voter: voter4,
        support: Enums.VoteType.Abstain,
        weight: web3.utils.toWei('2'),
      },
    );

    await helper.waitForDeadline();

    const txExecute = await helper.execute();

    expectEvent(
      txExecute,
      'ProposalExecuted',
      { proposalId: this.details.id },
    );

    await expectEvent.inTransaction(
      txExecute.tx,
      this.receiver,
      'MockFunctionCalled',
    );

    // After
    expect(await this.mock.hasVoted(this.details.id, owner)).to.be.equal(false);
    expect(await this.mock.hasVoted(this.details.id, voter1)).to.be.equal(true);
    expect(await this.mock.hasVoted(this.details.id, voter2)).to.be.equal(true);
    expect(await web3.eth.getBalance(this.mock.address)).to.be.bignumber.equal('0');
    expect(await web3.eth.getBalance(this.receiver.address)).to.be.bignumber.equal(value);
  });

  it('vote with signature', async function () {
    const voterBySig = Wallet.generate();
    const voterBySigAddress = web3.utils.toChecksumAddress(voterBySig.getAddressString());

    const signature = async (message) => {
      return fromRpcSig(ethSigUtil.signTypedMessage(
        voterBySig.getPrivateKey(),
        {
          data: {
            types: {
              EIP712Domain,
              Ballot: [
                { name: 'proposalId', type: 'uint256' },
                { name: 'support', type: 'uint8' },
              ],
            },
            domain: { name, version, chainId: this.chainId, verifyingContract: this.mock.address },
            primaryType: 'Ballot',
            message,
          },
        },
      ));
    };

    await this.token.delegate(voterBySigAddress, { from: voter1 });

    // Run proposal
    await helper.propose();
    await helper.waitForSnapshot();
    expectEvent(
      await helper.vote({ support: Enums.VoteType.For, signature }),
      'VoteCast',
      { voter: voterBySigAddress, support: Enums.VoteType.For },
    );
    await helper.waitForDeadline();
    await helper.execute();

    // After
    expect(await this.mock.hasVoted(this.details.id, owner)).to.be.equal(false);
    expect(await this.mock.hasVoted(this.details.id, voter1)).to.be.equal(false);
    expect(await this.mock.hasVoted(this.details.id, voter2)).to.be.equal(false);
    expect(await this.mock.hasVoted(this.details.id, voterBySigAddress)).to.be.equal(true);
  });

  it('send ethers', async function () {
    this.details = helper.setProposal([
      [ empty ],
      [ value ],
      [ '0x' ],
      '<proposal description>',
    ]);

    // Before
    expect(await web3.eth.getBalance(this.mock.address)).to.be.bignumber.equal(value);
    expect(await web3.eth.getBalance(empty)).to.be.bignumber.equal('0');

    // Run proposal
    await helper.propose();
    await helper.waitForSnapshot();
    await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
    await helper.waitForDeadline();
    await helper.execute();

    // After
    expect(await web3.eth.getBalance(this.mock.address)).to.be.bignumber.equal('0');
    expect(await web3.eth.getBalance(empty)).to.be.bignumber.equal(value);
  });

  describe('should revert', function () {
    describe('on propose', function () {
      it('if proposal already exists', async function () {
        await helper.propose();
        await expectRevert(helper.propose(), 'Governor: proposal already exists');
      });
    });

    describe('on vote', function () {
      it('if proposal does not exist', async function () {
        await expectRevert(
          helper.vote({ support: Enums.VoteType.For }, { from: voter1 }),
          'Governor: unknown proposal id',
        );
      });

      it('if voting has not started', async function () {
        await helper.propose();
        await expectRevert(
          helper.vote({ support: Enums.VoteType.For }, { from: voter1 }),
          'Governor: vote not currently active',
        );
      });

      it('if support value is invalid', async function () {
        await helper.propose();
        await helper.waitForSnapshot();
        await expectRevert(
          helper.vote({ support: new BN('255') }),
          'GovernorVotingSimple: invalid value for enum VoteType',
        );
      });

      it('if vote was already casted', async function () {
        await helper.propose();
        await helper.waitForSnapshot();
        await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await expectRevert(
          helper.vote({ support: Enums.VoteType.For }, { from: voter1 }),
          'GovernorVotingSimple: vote already cast',
        );
      });

      it('if voting is over', async function () {
        await helper.propose();
        await helper.waitForDeadline();
        await expectRevert(
          helper.vote({ support: Enums.VoteType.For }, { from: voter1 }),
          'Governor: vote not currently active',
        );
      });
    });

    describe('on execute', function () {
      it('if proposal does not exist', async function () {
        await expectRevert(helper.execute(), 'Governor: unknown proposal id');
      });

      it('if quorum is not reached', async function () {
        await helper.propose();
        await helper.waitForSnapshot();
        await helper.vote({ support: Enums.VoteType.For }, { from: voter3 });
        await expectRevert(helper.execute(), 'Governor: proposal not successful');
      });

      it('if score not reached', async function () {
        await helper.propose();
        await helper.waitForSnapshot();
        await helper.vote({ support: Enums.VoteType.Against }, { from: voter1 });
        await expectRevert(helper.execute(), 'Governor: proposal not successful');
      });

      it('if voting is not over', async function () {
        await helper.propose();
        await helper.waitForSnapshot();
        await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await expectRevert(helper.execute(), 'Governor: proposal not successful');
      });

      it('if receiver revert without reason', async function () {
        this.details = helper.setProposal([
          [ this.receiver.address ],
          [ 0 ],
          [ this.receiver.contract.methods.mockFunctionRevertsNoReason().encodeABI() ],
          '<proposal description>',
        ]);

        await helper.propose();
        await helper.waitForSnapshot();
        await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await helper.waitForDeadline();
        await expectRevert(helper.execute(), 'Governor: call reverted without message');
      });

      it('if receiver revert with reason', async function () {
        this.details = helper.setProposal([
          [ this.receiver.address ],
          [ 0 ],
          [ this.receiver.contract.methods.mockFunctionRevertsReason().encodeABI() ],
          '<proposal description>',
        ]);

        await helper.propose();
        await helper.waitForSnapshot();
        await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await helper.waitForDeadline();
        await expectRevert(helper.execute(), 'CallReceiverMock: reverting');
      });

      it('if proposal was already executed', async function () {
        await helper.propose();
        await helper.waitForSnapshot();
        await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
        await helper.waitForDeadline();
        await helper.execute();
        await expectRevert(helper.execute(), 'Governor: proposal not successful');
      });
    });
  });

  describe('state', function () {
    it('Unset', async function () {
      await expectRevert(this.mock.state(this.details.id), 'Governor: unknown proposal id');
    });

    it('Pending & Active', async function () {
      await helper.propose();
      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Pending);
      await helper.waitForSnapshot();
      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Pending);
      await helper.waitForSnapshot(+1);
      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Active);
    });

    it('Defeated', async function () {
      await helper.propose();
      await helper.waitForDeadline();
      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Active);
      await helper.waitForDeadline(+1);
      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Defeated);
    });

    it('Succeeded', async function () {
      await helper.propose();
      await helper.waitForSnapshot();
      await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
      await helper.waitForDeadline();
      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Active);
      await helper.waitForDeadline(+1);
      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Succeeded);
    });

    it('Executed', async function () {
      await helper.propose();
      await helper.waitForSnapshot();
      await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
      await helper.waitForDeadline();
      await helper.execute();
      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Executed);
    });
  });

  describe('cancel', function () {
    it('before proposal', async function () {
      await expectRevert(helper.cancel(), 'Governor: unknown proposal id');
    });

    it('after proposal', async function () {
      await helper.propose();

      await helper.cancel();
      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Canceled);

      await helper.waitForSnapshot();
      await expectRevert(
        helper.vote({ support: Enums.VoteType.For }, { from: voter1 }),
        'Governor: vote not currently active',
      );
    });

    it('after vote', async function () {
      await helper.propose();
      await helper.waitForSnapshot();
      await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });

      await helper.cancel();
      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Canceled);

      await helper.waitForDeadline();
      await expectRevert(helper.execute(), 'Governor: proposal not successful');
    });

    it('after deadline', async function () {
      await helper.propose();
      await helper.waitForSnapshot();
      await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
      await helper.waitForDeadline();

      await helper.cancel();
      expect(await this.mock.state(this.details.id)).to.be.bignumber.equal(Enums.ProposalState.Canceled);

      await expectRevert(helper.execute(), 'Governor: proposal not successful');
    });

    it('after execution', async function () {
      await helper.propose();
      await helper.waitForSnapshot();
      await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
      await helper.waitForDeadline();
      await helper.execute();

      await expectRevert(helper.cancel(), 'Governor: proposal not active');
    });
  });

  describe('proposal length', function () {
    it('empty', async function () {
      helper.setProposal([
        [],
        [],
        [],
        '<proposal description>',
      ]);
      await expectRevert(helper.propose(), 'Governor: empty proposal');
    });

    it('missmatch #1', async function () {
      helper.setProposal([
        [ ],
        [ web3.utils.toWei('0') ],
        [ this.receiver.contract.methods.mockFunction().encodeABI() ],
        '<proposal description>',
      ]);
      await expectRevert(helper.propose(), 'Governor: invalid proposal length');
    });

    it('missmatch #2', async function () {
      helper.setProposal([
        [ this.receiver.address ],
        [ ],
        [ this.receiver.contract.methods.mockFunction().encodeABI() ],
        '<proposal description>',
      ]);
      await expectRevert(helper.propose(), 'Governor: invalid proposal length');
    });

    it('missmatch #3', async function () {
      helper.setProposal([
        [ this.receiver.address ],
        [ web3.utils.toWei('0') ],
        [ ],
        '<proposal description>',
      ]);
      await expectRevert(helper.propose(), 'Governor: invalid proposal length');
    });
  });

  describe('onlyGovernance updates', function () {
    it('setVotingDelay is protected', async function () {
      await expectRevert(this.mock.setVotingDelay('0'), 'Governor: onlyGovernance');
    });

    it('setVotingPeriod is protected', async function () {
      await expectRevert(this.mock.setVotingPeriod('32'), 'Governor: onlyGovernance');
    });

    it('setProposalThreshold is protected', async function () {
      await expectRevert(this.mock.setProposalThreshold('1000000000000000000'), 'Governor: onlyGovernance');
    });

    it('can setVotingDelay through governance', async function () {
      helper.setProposal([
        [ this.mock.address ],
        [ web3.utils.toWei('0') ],
        [ this.mock.contract.methods.setVotingDelay('0').encodeABI() ],
        '<proposal description>',
      ]);

      await helper.propose();
      await helper.waitForSnapshot();
      await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
      await helper.waitForDeadline();

      expectEvent(
        await helper.execute(),
        'VotingDelaySet',
        { oldVotingDelay: '4', newVotingDelay: '0' },
      );

      expect(await this.mock.votingDelay()).to.be.bignumber.equal('0');
    });

    it('can setVotingPeriod through governance', async function () {
      helper.setProposal([
        [ this.mock.address ],
        [ web3.utils.toWei('0') ],
        [ this.mock.contract.methods.setVotingPeriod('32').encodeABI() ],
        '<proposal description>',
      ]);

      await helper.propose();
      await helper.waitForSnapshot();
      await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
      await helper.waitForDeadline();

      expectEvent(
        await helper.execute(),
        'VotingPeriodSet',
        { oldVotingPeriod: '16', newVotingPeriod: '32' },
      );

      expect(await this.mock.votingPeriod()).to.be.bignumber.equal('32');
    });

    it('cannot setVotingPeriod to 0 through governance', async function () {
      helper.setProposal([
        [ this.mock.address ],
        [ web3.utils.toWei('0') ],
        [ this.mock.contract.methods.setVotingPeriod('0').encodeABI() ],
        '<proposal description>',
      ]);

      await helper.propose();
      await helper.waitForSnapshot();
      await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
      await helper.waitForDeadline();

      await expectRevert(helper.execute(), 'GovernorSettings: voting period too low');
    });

    it('can setProposalThreshold to 0 through governance', async function () {
      helper.setProposal([
        [ this.mock.address ],
        [ web3.utils.toWei('0') ],
        [ this.mock.contract.methods.setProposalThreshold('1000000000000000000').encodeABI() ],
        '<proposal description>',
      ]);

      await helper.propose();
      await helper.waitForSnapshot();
      await helper.vote({ support: Enums.VoteType.For }, { from: voter1 });
      await helper.waitForDeadline();

      expectEvent(
        await helper.execute(),
        'ProposalThresholdSet',
        { oldProposalThreshold: '0', newProposalThreshold: '1000000000000000000' },
      );

      expect(await this.mock.proposalThreshold()).to.be.bignumber.equal('1000000000000000000');
    });
  });
});
