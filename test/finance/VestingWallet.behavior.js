const { expect } = require('chai');
const { bigint: time } = require('../helpers/time');

function shouldBehaveLikeVesting() {
  it('check vesting schedule', async function () {
    for (const timestamp of this.schedule) {
      await time.forward.timestamp(timestamp);
      const vesting = this.vestingFn(timestamp);

      expect(await this.mock.vestedAmount(...this.args, timestamp)).to.be.equal(vesting);
      expect(await this.mock.releasable(...this.args)).to.be.equal(vesting);
    }
  });

  it('execute vesting schedule', async function () {
    let released = 0n;
    {
      const tx = await this.mock.release(...this.args);
      await this.checkRelease(tx, 0n);
    }

    for (const timestamp of this.schedule) {
      await time.forward.timestamp(timestamp, false);
      const vested = this.vestingFn(timestamp);

      const tx = await this.mock.release(...this.args);
      await this.checkRelease(tx, vested - released);
      released = vested;
    }
  });

  it('should revert on transaction faillure', async function () {
    const { args, error } = await this.setupFaillure();

    for (const timestamp of this.schedule) {
      await time.forward.timestamp(timestamp);

      await expect(this.mock.release(...args)).to.be.revertedWithCustomError(...error);
    }
  });
}

module.exports = {
  shouldBehaveLikeVesting,
};
