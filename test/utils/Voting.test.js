const { expectRevert } = require('@openzeppelin/test-helpers');

const { expect } = require('chai');

const Votes = artifacts.require('VotesMock');

contract('Voting', function (accounts) {
  const [ account1, account2, account3 ] = accounts;
  beforeEach(async function () {
    this.voting = await Votes.new("MyVote");
  });

  it('starts with zero votes', async function () {
    expect(await this.voting.getTotalVotes()).to.be.bignumber.equal('0');
  });

  describe('move voting power', function () {
    beforeEach(async function () {
      this.tx1 = await this.voting.giveVotingPower(account1, 1);
      this.tx2 = await this.voting.giveVotingPower(account2, 1);
      this.tx3 = await this.voting.giveVotingPower(account3, 1);
    });

    it('reverts if block number >= current block', async function () {
      await expectRevert(
        this.voting.getTotalVotesAt(this.tx3.receipt.blockNumber + 1),
        'block not yet mined',
      );
    });

    it('delegates', async function () {
      await this.voting.delegate(account3, account2, 1);

      expect(await this.voting.delegates(account3)).to.be.equal(account2);
    });
  });
});
