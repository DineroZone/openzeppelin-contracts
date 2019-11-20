const { accounts, contract } = require('@openzeppelin/test-environment');
const [ minter, ...otherAccounts ] = accounts;

const { BN, ether, expectRevert } = require('@openzeppelin/test-helpers');
const { shouldBehaveLikeERC20Mintable } = require('./behaviors/ERC20Mintable.behavior');
const { shouldBehaveLikeERC20Capped } = require('./behaviors/ERC20Capped.behavior');

const ERC20Capped = contract.fromArtifact('ERC20Capped');

describe('ERC20Capped', function () {
  const cap = ether('1000');

  it('requires a non-zero cap', async function () {
    await expectRevert(
      ERC20Capped.new(new BN(0), { from: minter }), 'ERC20Capped: cap is 0'
    );
  });

  context('once deployed', async function () {
    beforeEach(async function () {
      this.token = await ERC20Capped.new(cap, { from: minter });
    });

    shouldBehaveLikeERC20Capped(minter, otherAccounts, cap);
    shouldBehaveLikeERC20Mintable(minter, otherAccounts);
  });
});
