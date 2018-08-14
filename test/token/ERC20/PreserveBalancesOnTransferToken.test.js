const BigNumber = web3.BigNumber;

const PreserveBalancesOnTransferToken = artifacts.require('PreserveBalancesOnTransferToken');
const PreserveBalancesMock = artifacts.require('PreserveBalancesMock');
const SnapshotToken = artifacts.require('SnapshotToken');

// Increases ganache time by the passed duration in seconds
function increaseTime (duration) {
  const id = Date.now();

  return new Promise((resolve, reject) => {
    web3.currentProvider.sendAsync({
      jsonrpc: '2.0',
      method: 'evm_increaseTime',
      params: [duration],
      id: id,
    }, err1 => {
      if (err1) return reject(err1);

      web3.currentProvider.sendAsync({
        jsonrpc: '2.0',
        method: 'evm_mine',
        id: id + 1,
      }, (err2, res) => {
        return err2 ? reject(err2) : resolve(res);
      });
    });
  });
}

function increaseTimeTo (target) {
  const now = web3.eth.getBlock('latest').timestamp;
  if (target < now) throw Error(`Cannot increase current time(${now}) to a moment in the past(${target})`);
  const diff = target - now;
  return increaseTime(diff);
}

const duration = {
  seconds: function (val) { return val; },
  minutes: function (val) { return val * this.seconds(60); },
  hours: function (val) { return val * this.minutes(60); },
  days: function (val) { return val * this.hours(24); },
  weeks: function (val) { return val * this.days(7); },
  years: function (val) { return val * this.days(365); },
};

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(BigNumber))
  .should();

contract('PreserveBalancesOnTransferToken', (accounts) => {
  const creator = accounts[0];
  const account3 = accounts[3];
  const account4 = accounts[4];
  const account5 = accounts[5];

  beforeEach(async function () {

  });

  describe('mint', function () {
    it('should fail due to not owner call', async function () {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.mint(web3.eth.accounts[1], 1000,
        { from: web3.eth.accounts[1] }).should.be.rejectedWith('revert');
    });

    it('should fail with isMintable = false', async function () {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.mint(web3.eth.accounts[1], 1000);
    });

    it('should fail due to finishMinting() call', async function () {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.finishMinting();
      await this.token.mint(web3.eth.accounts[1], 1000).should.be.rejectedWith('revert');
    });

    it('should pass', async function () {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.mint(web3.eth.accounts[0], 1000);
      const balance = await this.token.balanceOf(web3.eth.accounts[0]);
      assert.equal(balance.toNumber(), 1000);
    });
  });

  describe('burn', function () {
    it('should fail due to not owner call', async function () {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.mint(web3.eth.accounts[1], 1000);
      await this.token.burn(1000, { from: web3.eth.accounts[0] }).should.be.rejectedWith('revert');
    });

    it('should fail due to not enough tokens in the address provided', async function () {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.burn(1000).should.be.rejectedWith('revert');
    });

    it('should pass', async function () {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.mint(web3.eth.accounts[0], 1000);
      await this.token.burn(1000);
      const balance = await this.token.balanceOf(web3.eth.accounts[0]);
      assert.equal(balance.toNumber(), 0);
    });
  });

  describe('startNewEvent', function () {
    it('should allow to create many separate events', async () => {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.startNewEvent().should.be.fulfilled;// 1
      await this.token.startNewEvent().should.be.fulfilled;// 2
    });

    it('should not be possible to call by non-owner', async () => {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.startNewEvent({ from: account3 }).should.be.rejectedWith('revert');
    });
  });

  describe('getBalanceAtEventStart', function () {
    it('should preserve balances if no transfers happened after event is started', async () => {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.mint(account4, 1);

      const account4Balance = await this.token.balanceOf(account4);
      const account5Balance = await this.token.balanceOf(account5);

      assert.equal(account4Balance.toNumber(), 1);
      assert.equal(account5Balance.toNumber(), 0);

      const tx = await this.token.startNewEvent();
      const events = tx.logs.filter(l => l.event === 'EventStarted');
      const eventID = events.filter(e => e.args._address === creator)[0].args._eventID;

      const account4EventBalance = await this.token.getBalanceAtEventStart(eventID, account4);
      const account5EventBalance = await this.token.getBalanceAtEventStart(eventID, account5);

      assert.equal(account4EventBalance.toNumber(), 1);
      assert.equal(account5EventBalance.toNumber(), 0);
    });

    it('should preserve balances after event is started', async () => {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.mint(account4, 1);

      const tx = await this.token.startNewEvent();
      const events = tx.logs.filter(l => l.event === 'EventStarted');
      const eventID = events.filter(e => e.args._address === creator)[0].args._eventID;

      await this.token.transfer(account5, 1, { from: account4 });

      const account4Balance = await this.token.balanceOf(account4);
      const account5Balance = await this.token.balanceOf(account5);

      const account4EventBalance = await this.token.getBalanceAtEventStart(eventID, account4);
      const account5EventBalance = await this.token.getBalanceAtEventStart(eventID, account5);

      assert.equal(account4Balance.toNumber(), 0);
      assert.equal(account5Balance.toNumber(), 1);

      assert.equal(account4EventBalance.toNumber(), 1);
      assert.equal(account5EventBalance.toNumber(), 0);
    });

    it('should preserve balances after event is started and mint called', async () => {
      this.token = await PreserveBalancesOnTransferToken.new();

      const tx = await this.token.startNewEvent();
      const events = tx.logs.filter(l => l.event === 'EventStarted');
      const eventID = events.filter(e => e.args._address === creator)[0].args._eventID;

      await this.token.mint(account4, 1);

      const account4Balance = await this.token.balanceOf(account4);
      const account4EventBalance = await this.token.getBalanceAtEventStart(eventID, account4);

      assert.equal(account4Balance.toNumber(), 1);
      assert.equal(account4EventBalance.toNumber(), 0);
    });

    it('should throw exception when trying to check balancesAtVoting after event is ended', async () => {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.mint(account4, 1);

      const tx = await this.token.startNewEvent();
      const events = tx.logs.filter(l => l.event === 'EventStarted');
      const eventID = events.filter(e => e.args._address === creator)[0].args._eventID;

      await this.token.transfer(account5, 1, { from: account4 });

      let account4Balance = await this.token.balanceOf(account4);
      let account5Balance = await this.token.balanceOf(account5);

      assert.equal(account4Balance.toNumber(), 0);
      assert.equal(account5Balance.toNumber(), 1);

      await this.token.finishEvent(eventID);

      account4Balance = await this.token.balanceOf(account4);
      account5Balance = await this.token.balanceOf(account5);

      assert.equal(account4Balance.toNumber(), 0);
      assert.equal(account5Balance.toNumber(), 1);

      await this.token.getBalanceAtEventStart(eventID, account4).should.be.rejectedWith('revert');
    });

    it('should preserve balances after event is started and transferFrom is called', async () => {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.mint(account4, 1);

      const tx = await this.token.startNewEvent();
      const events = tx.logs.filter(l => l.event === 'EventStarted');
      const eventID = events.filter(e => e.args._address === creator)[0].args._eventID;

      await this.token.approve(account3, 1, { from: account4 });
      await this.token.transferFrom(account4, account5, 1, { from: account3 });

      const account4Balance = await this.token.balanceOf(account4);
      const account5Balance = await this.token.balanceOf(account5);

      const account4EventBalance = await this.token.getBalanceAtEventStart(eventID, account4);
      const account5EventBalance = await this.token.getBalanceAtEventStart(eventID, account5);

      assert.equal(account4Balance.toNumber(), 0);
      assert.equal(account5Balance.toNumber(), 1);

      assert.equal(account4EventBalance.toNumber(), 1);
      assert.equal(account5EventBalance.toNumber(), 0);
    });

    it('should throw exception because event is not started yet', async function () {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.mint(web3.eth.accounts[0], 1000);
      await this.token.getBalanceAtEventStart(0, web3.eth.accounts[0]).should.be.rejectedWith('revert');
    });

    it('should work correctly if time passed and new event is started', async () => {
      this.token = await PreserveBalancesOnTransferToken.new();

      await this.token.mint(account3, 100);
      await this.token.mint(account4, 20);

      // 1 - create event 1
      const tx = await this.token.startNewEvent();
      const events = tx.logs.filter(l => l.event === 'EventStarted');
      const eventID1 = events.filter(e => e.args._address === creator)[0].args._eventID;

      // 2 - transfer tokens
      await this.token.transfer(account5, 5, { from: account3 });
      await this.token.transfer(account5, 7, { from: account4 });

      assert.equal(await this.token.balanceOf(account3), 95);
      assert.equal(await this.token.balanceOf(account4), 13);
      assert.equal(await this.token.balanceOf(account5), 12);

      assert.equal(await this.token.getBalanceAtEventStart(eventID1, account3), 100);
      assert.equal(await this.token.getBalanceAtEventStart(eventID1, account4), 20);
      assert.equal(await this.token.getBalanceAtEventStart(eventID1, account5), 0);

      // 3 - finish event
      await this.token.finishEvent(eventID1);
      // 4 - increase time
      const now = web3.eth.getBlock('latest').timestamp;
      await increaseTimeTo(now + duration.seconds(1));

      // 5 - create event 2
      const tx2 = await this.token.startNewEvent();
      const events2 = tx2.logs.filter(l => l.event === 'EventStarted');
      const eventID2 = events2.filter(e => e.args._address === creator)[0].args._eventID;

      // 6 - CHECK BALANCES
      assert.equal(await this.token.balanceOf(account3), 95);
      assert.equal(await this.token.balanceOf(account4), 13);
      assert.equal(await this.token.balanceOf(account5), 12);

      assert.equal(await this.token.getBalanceAtEventStart(eventID2, account3), 95);
      assert.equal(await this.token.getBalanceAtEventStart(eventID2, account4), 13);
      assert.equal(await this.token.getBalanceAtEventStart(eventID2, account5), 12);

      // 7 - transfer tokens again
      await this.token.transfer(account5, 2, { from: account3 });
      await this.token.transfer(account5, 1, { from: account4 });

      // 8 - CHECK BALANCES again
      assert.equal(await this.token.balanceOf(account3), 93);
      assert.equal(await this.token.balanceOf(account4), 12);
      assert.equal(await this.token.balanceOf(account5), 15);

      assert.equal(await this.token.getBalanceAtEventStart(eventID2, account3), 95);
      assert.equal(await this.token.getBalanceAtEventStart(eventID2, account4), 13);
      assert.equal(await this.token.getBalanceAtEventStart(eventID2, account5), 12);

      // 9 - finish event
      await this.token.finishEvent(eventID2);
    });

    // That is a feature, not a bug!
    it('should work correctly if time NOT passed and new event is started', async () => {
      this.token = await PreserveBalancesOnTransferToken.new();

      await this.token.mint(account3, 100);
      await this.token.mint(account4, 20);

      // 1 - create event 1
      const tx = await this.token.startNewEvent();
      const events = tx.logs.filter(l => l.event === 'EventStarted');
      const eventID1 = events.filter(e => e.args._address === creator)[0].args._eventID;

      // 2 - transfer tokens
      await this.token.transfer(account5, 5, { from: account3 });
      await this.token.transfer(account5, 7, { from: account4 });

      assert.equal(await this.token.balanceOf(account3), 95);
      assert.equal(await this.token.balanceOf(account4), 13);
      assert.equal(await this.token.balanceOf(account5), 12);

      assert.equal(await this.token.getBalanceAtEventStart(eventID1, account3), 100);
      assert.equal(await this.token.getBalanceAtEventStart(eventID1, account4), 20);
      assert.equal(await this.token.getBalanceAtEventStart(eventID1, account5), 0);

      // 3 - finish event
      await this.token.finishEvent(eventID1);
      // 4 - DO NOT increase time!!!
      // let now = web3.eth.getBlock('latest').timestamp;
      // await increaseTimeTo(now + duration.seconds(1));

      // 5 - create event 2
      const tx2 = await this.token.startNewEvent();
      const events2 = tx2.logs.filter(l => l.event === 'EventStarted');
      const eventID2 = events2.filter(e => e.args._address === creator)[0].args._eventID;

      // 6 - CHECK BALANCES
      assert.equal(await this.token.balanceOf(account3), 95);
      assert.equal(await this.token.balanceOf(account4), 13);
      assert.equal(await this.token.balanceOf(account5), 12);

      // WARNING:
      // We do not give STRONG guarantees.
      // In case time has not passed - it will return 100
      // in case time HAS passed between the calls - it will return 95!
      //
      // We do not give STRONG guarantees. The return value is time-dependent:
      // If startNewEvent() is called and then immediately getBalanceAtEventStart() -> it CAN return wrong data
      // In case time between these calls has passed -> the return value is ALWAYS correct.
      const balance = await this.token.getBalanceAtEventStart(eventID2, account3);
      const isEqual = (balance.toNumber() === 100) || (balance.toNumber() === 95);
      assert.equal(isEqual, true);
    });
  });

  describe('finishEvent', function () {
    it('should not be possible to call by non-owner', async () => {
      this.token = await PreserveBalancesOnTransferToken.new();

      const tx = await this.token.startNewEvent();
      const events = tx.logs.filter(l => l.event === 'EventStarted');
      const eventID = events.filter(e => e.args._address === creator)[0].args._eventID;
      await this.token.finishEvent(eventID, { from: account3 }).should.be.rejectedWith('revert');
    });

    it('should throw revert() if VotingID is wrong', async () => {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.mint(account4, 1);

      const tx = await this.token.startNewEvent();
      const events = tx.logs.filter(l => l.event === 'EventStarted');
      const eventID = events.filter(e => e.args._address === creator)[0].args._eventID;

      await this.token.transfer(account5, 1, { from: account4 });

      const account4EventBalance = await this.token.getBalanceAtEventStart(eventID, account4);
      const account5EventBalance = await this.token.getBalanceAtEventStart(eventID, account5);

      assert.equal(account4EventBalance.toNumber(), 1);
      assert.equal(account5EventBalance.toNumber(), 0);

      await this.token.finishEvent(75).should.be.rejectedWith('revert');
    });
  });

  describe('createNewSnapshot', function () {
    it('should fail due to not owner call', async function () {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.createNewSnapshot(
        { from: web3.eth.accounts[1] }).should.be.rejectedWith('revert');
    });

    it('should succeed', async function () {
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.createNewSnapshot().should.be.fulfilled;
    });
  });

  describe('stopSnapshot', function () {
    it('should fail due to not owner call', async function () {
      this.token = await PreserveBalancesOnTransferToken.new();

      const tx = await this.token.createNewSnapshot();
      const events = tx.logs.filter(l => l.event === 'SnapshotCreated');
      const snapshotTokenAddress = events[0].args._snapshotTokenAddress;

      this.snapshot = await SnapshotToken.at(snapshotTokenAddress);
      await this.token.stopSnapshot(
        this.snapshot.address,
        { from: web3.eth.accounts[1] }).should.be.rejectedWith('revert');
    });

    it('should succeed', async function () {
      this.token = await PreserveBalancesOnTransferToken.new();

      const tx = await this.token.createNewSnapshot();
      const events = tx.logs.filter(l => l.event === 'SnapshotCreated');
      const snapshotTokenAddress = events[0].args._snapshotTokenAddress;

      this.snapshot = await SnapshotToken.at(snapshotTokenAddress);
      await this.token.stopSnapshot(this.snapshot.address).should.be.fulfilled;
    });
  });
});

contract('SnapshotToken', (accounts) => {
  const account3 = accounts[3];
  const account4 = accounts[4];
  const account5 = accounts[5];

  beforeEach(async function () {

  });

  describe('start', function () {
    it('should fail because not called from the PreserveBalancesOnTransferToken', async function () {
      this.token = await PreserveBalancesMock.new();
      this.snapshot = await SnapshotToken.new(this.token.address);

      await this.snapshot.start(
        { from: web3.eth.accounts[1] }).should.be.rejectedWith('revert');
    });

    it('should fail if already started', async function () {
      this.token = await PreserveBalancesMock.new();
      this.snapshot = await SnapshotToken.new(this.token.address);

      await this.token.testCallStartForSnapshot(this.snapshot.address).should.be.fulfilled;
      await this.token.testCallStartForSnapshot(this.snapshot.address).should.be.rejectedWith('revert');
    });

    it('should succeed', async function () {
      this.token = await PreserveBalancesMock.new();
      this.snapshot = await SnapshotToken.new(this.token.address);

      await this.token.testCallStartForSnapshot(this.snapshot.address).should.be.fulfilled;
    });
  });

  describe('finish', function () {
    it('should fail because not called by the owner', async function () {
      this.token = await PreserveBalancesMock.new();

      const tx = await this.token.createNewSnapshot();
      const events = tx.logs.filter(l => l.event === 'SnapshotCreated');
      const snapshotTokenAddress = events[0].args._snapshotTokenAddress;

      this.snapshot = await SnapshotToken.at(snapshotTokenAddress);
      await this.snapshot.finish({ from: web3.eth.accounts[1] }).should.be.rejectedWith('revert');
      await this.snapshot.finish().should.be.rejectedWith('revert');
    });

    it('should fail if was not started', async function () {
      this.token = await PreserveBalancesMock.new();
      this.snapshot = await SnapshotToken.new(this.token.address);

      await this.token.testCallFinishForSnapshot(this.snapshot.address).should.be.rejectedWith('revert');
    });

    it('should succeed', async function () {
      this.token = await PreserveBalancesMock.new();
      this.snapshot = await SnapshotToken.new(this.token.address);

      await this.token.testCallStartForSnapshot(this.snapshot.address);
      await this.token.testCallFinishForSnapshot(this.snapshot.address).should.be.fulfilled;
    });
  });

  describe('balanceOf', function () {
    it('should fail if not started', async function () {
      this.token = await PreserveBalancesMock.new();
      await this.token.mint(web3.eth.accounts[0], 1000);

      this.snapshot = await SnapshotToken.new(this.token.address);
      await this.snapshot.balanceOf(web3.eth.accounts[0]).should.be.rejectedWith('revert');
    });

    it('should return correct value if minted some tokens', async function () {
      // not a mock contract here!
      this.token = await PreserveBalancesOnTransferToken.new();

      // this calls 'start' automatically
      const tx = await this.token.createNewSnapshot();
      const events = tx.logs.filter(l => l.event === 'SnapshotCreated');
      const snapshotTokenAddress = events[0].args._snapshotTokenAddress;

      this.snapshot = await SnapshotToken.at(snapshotTokenAddress);

      await this.token.mint(web3.eth.accounts[0], 1000);

      const balanceReal = await this.token.balanceOf(web3.eth.accounts[0]);
      const balanceAtStart = await this.snapshot.balanceOf(web3.eth.accounts[0]);

      assert.equal(balanceReal.toNumber(), 1000);
      assert.equal(balanceAtStart.toNumber(), 0);
    });

    it('should return correct value if transferred some tokens', async function () {
      // not a mock contract here!
      this.token = await PreserveBalancesOnTransferToken.new();
      await this.token.mint(web3.eth.accounts[0], 1000);

      // this calls 'start' automatically
      const tx = await this.token.createNewSnapshot();
      const events = tx.logs.filter(l => l.event === 'SnapshotCreated');
      const snapshotTokenAddress = events[0].args._snapshotTokenAddress;

      this.snapshot = await SnapshotToken.at(snapshotTokenAddress);
      await this.token.transfer(web3.eth.accounts[1], 200);

      const balanceReal = await this.token.balanceOf(web3.eth.accounts[0]);
      const balanceReal2 = await this.token.balanceOf(web3.eth.accounts[1]);
      const balanceAtStart = await this.snapshot.balanceOf(web3.eth.accounts[0]);
      const balanceAtStart2 = await this.snapshot.balanceOf(web3.eth.accounts[1]);

      assert.equal(balanceReal.toNumber(), 800);
      assert.equal(balanceReal2.toNumber(), 200);

      assert.equal(balanceAtStart.toNumber(), 1000);
      assert.equal(balanceAtStart2.toNumber(), 0);
    });
  });

  describe('transfer', function () {
    it('should be blocked', async function () {
      this.token = await PreserveBalancesMock.new();
      await this.token.mint(web3.eth.accounts[0], 1000);

      this.snapshot = await SnapshotToken.new(this.token.address);
      await this.snapshot.transfer(web3.eth.accounts[1], 200).should.be.rejectedWith('revert');
    });
  });

  describe('transferFrom', function () {
    it('should be blocked', async function () {
      this.token = await PreserveBalancesMock.new();
      await this.token.mint(account4, 1000);

      this.snapshot = await SnapshotToken.new(this.token.address);

      await this.snapshot.approve(account3, 1, { from: account4 });
      await this.snapshot.transferFrom(account4, account5, 1, { from: account3 }).should.be.rejectedWith('revert');
    });
  });
});
