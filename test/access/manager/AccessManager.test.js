const { expectEvent, constants, time } = require('@openzeppelin/test-helpers');
const { expectRevertCustomError } = require('../../helpers/customError');
const { AccessMode } = require('../../helpers/enums');
const { selector } = require('../../helpers/methods');
const { clockFromReceipt } = require('../../helpers/time');

const AccessManager = artifacts.require('$AccessManager');
const AccessManagedTarget = artifacts.require('$AccessManagedTarget');

const GROUPS = {
  ADMIN: web3.utils.toBN(0),
  SOME_ADMIN: web3.utils.toBN(17),
  SOME: web3.utils.toBN(42),
  PUBLIC: constants.MAX_UINT256,
};
Object.assign(GROUPS, Object.fromEntries(Object.entries(GROUPS).map(([key, value]) => [value, key])));

const executeDelay = web3.utils.toBN(10);
const grantDelay = web3.utils.toBN(10);

contract('AccessManager', function (accounts) {
  const [admin, manager, member, user, other] = accounts;

  beforeEach(async function () {
    this.manager = await AccessManager.new(admin);
    this.target = await AccessManagedTarget.new(this.manager.address);

    // add member to group
    await this.manager.$_setGroupAdmin(GROUPS.SOME, GROUPS.SOME_ADMIN);
    await this.manager.$_setGroupGuardian(GROUPS.SOME, GROUPS.SOME_ADMIN);
    await this.manager.$_grantGroup(GROUPS.SOME_ADMIN, manager, 0, 0);
    await this.manager.$_grantGroup(GROUPS.SOME, member, 0, 0);

    // helpers for indirect calls
    this.call = [this.target.address, selector('fnRestricted()')];
    this.opId = web3.utils.keccak256(
      web3.eth.abi.encodeParameters(['address', 'address', 'bytes'], [user, ...this.call]),
    );
    this.direct = (opts = {}) => this.target.fnRestricted({ from: user, ...opts });
    this.schedule = (opts = {}) => this.manager.schedule(...this.call, 0, { from: user, ...opts });
    this.relay = (opts = {}) => this.manager.relay(...this.call, { from: user, ...opts });
    this.cancel = (opts = {}) => this.manager.cancel(user, ...this.call, { from: user, ...opts });
  });

  it('groups are correctly initialized', async function () {
    // group admin
    expect(await this.manager.getGroupAdmin(GROUPS.ADMIN)).to.be.bignumber.equal(GROUPS.ADMIN);
    expect(await this.manager.getGroupAdmin(GROUPS.SOME_ADMIN)).to.be.bignumber.equal(GROUPS.ADMIN);
    expect(await this.manager.getGroupAdmin(GROUPS.SOME)).to.be.bignumber.equal(GROUPS.SOME_ADMIN);
    expect(await this.manager.getGroupAdmin(GROUPS.PUBLIC)).to.be.bignumber.equal(GROUPS.ADMIN);
    // group guardian
    expect(await this.manager.getGroupGuardian(GROUPS.ADMIN)).to.be.bignumber.equal(GROUPS.ADMIN);
    expect(await this.manager.getGroupGuardian(GROUPS.SOME_ADMIN)).to.be.bignumber.equal(GROUPS.ADMIN);
    expect(await this.manager.getGroupGuardian(GROUPS.SOME)).to.be.bignumber.equal(GROUPS.SOME_ADMIN);
    expect(await this.manager.getGroupGuardian(GROUPS.PUBLIC)).to.be.bignumber.equal(GROUPS.ADMIN);
    // group members
    expect(await this.manager.hasGroup(GROUPS.ADMIN, admin)).to.be.equal(true);
    expect(await this.manager.hasGroup(GROUPS.ADMIN, manager)).to.be.equal(false);
    expect(await this.manager.hasGroup(GROUPS.ADMIN, member)).to.be.equal(false);
    expect(await this.manager.hasGroup(GROUPS.ADMIN, user)).to.be.equal(false);
    expect(await this.manager.hasGroup(GROUPS.SOME_ADMIN, admin)).to.be.equal(false);
    expect(await this.manager.hasGroup(GROUPS.SOME_ADMIN, manager)).to.be.equal(true);
    expect(await this.manager.hasGroup(GROUPS.SOME_ADMIN, member)).to.be.equal(false);
    expect(await this.manager.hasGroup(GROUPS.SOME_ADMIN, user)).to.be.equal(false);
    expect(await this.manager.hasGroup(GROUPS.SOME, admin)).to.be.equal(false);
    expect(await this.manager.hasGroup(GROUPS.SOME, manager)).to.be.equal(false);
    expect(await this.manager.hasGroup(GROUPS.SOME, member)).to.be.equal(true);
    expect(await this.manager.hasGroup(GROUPS.SOME, user)).to.be.equal(false);
    expect(await this.manager.hasGroup(GROUPS.PUBLIC, admin)).to.be.equal(true);
    expect(await this.manager.hasGroup(GROUPS.PUBLIC, manager)).to.be.equal(true);
    expect(await this.manager.hasGroup(GROUPS.PUBLIC, member)).to.be.equal(true);
    expect(await this.manager.hasGroup(GROUPS.PUBLIC, user)).to.be.equal(true);
  });

  describe('Groups management', function () {
    describe('label group', function () {
      it('admin can emit a label event', async function () {
        expectEvent(await this.manager.labelGroup(GROUPS.SOME, 'Some label', { from: admin }), 'GroupLabel', {
          groupId: GROUPS.SOME,
          label: 'Some label',
        });
      });

      it('admin can re-emit a label event', async function () {
        await this.manager.labelGroup(GROUPS.SOME, 'Some label', { from: admin });

        expectEvent(await this.manager.labelGroup(GROUPS.SOME, 'Updated label', { from: admin }), 'GroupLabel', {
          groupId: GROUPS.SOME,
          label: 'Updated label',
        });
      });

      it('emitting a label is restricted', async function () {
        await expectRevertCustomError(
          this.manager.labelGroup(GROUPS.SOME, 'Invalid label', { from: other }),
          'AccessControlUnauthorizedAccount',
          [other, GROUPS.ADMIN],
        );
      });
    });

    describe('grand group', function () {
      describe('without a grant delay', function () {
        it('without an execute delay', async function () {
          expect(await this.manager.hasGroup(GROUPS.SOME, user)).to.be.false;

          const { receipt } = await this.manager.grantGroup(GROUPS.SOME, user, 0, { from: manager });
          const timestamp = await clockFromReceipt.timestamp(receipt).then(web3.utils.toBN);
          expectEvent(receipt, 'GroupGranted', { groupId: GROUPS.SOME, account: user, since: timestamp, delay: '0' });

          expect(await this.manager.hasGroup(GROUPS.SOME, user)).to.be.true;

          const access = await this.manager.getAccess(GROUPS.SOME, user);
          expect(access[0]).to.be.bignumber.equal(timestamp); // inGroupSince
          expect(access[1]).to.be.bignumber.equal('0'); // currentDelay
          expect(access[2]).to.be.bignumber.equal('0'); // pendingDelay
          expect(access[3]).to.be.bignumber.equal('0'); // effect
        });

        it('with an execute delay', async function () {
          expect(await this.manager.hasGroup(GROUPS.SOME, user)).to.be.false;

          const { receipt } = await this.manager.grantGroup(GROUPS.SOME, user, executeDelay, { from: manager });
          const timestamp = await clockFromReceipt.timestamp(receipt).then(web3.utils.toBN);
          expectEvent(receipt, 'GroupGranted', {
            groupId: GROUPS.SOME,
            account: user,
            since: timestamp,
            delay: executeDelay,
          });

          expect(await this.manager.hasGroup(GROUPS.SOME, user)).to.be.true;

          const access = await this.manager.getAccess(GROUPS.SOME, user);
          expect(access[0]).to.be.bignumber.equal(timestamp); // inGroupSince
          expect(access[1]).to.be.bignumber.equal(executeDelay); // currentDelay
          expect(access[2]).to.be.bignumber.equal('0'); // pendingDelay
          expect(access[3]).to.be.bignumber.equal('0'); // effect
        });

        it('to a user that is already in the group', async function () {
          expect(await this.manager.hasGroup(GROUPS.SOME, member)).to.be.true;

          await expectRevertCustomError(
            this.manager.grantGroup(GROUPS.SOME, member, 0, { from: manager }),
            'AccessManagerAcountAlreadyInGroup',
            [GROUPS.SOME, member],
          );
        });

        it('to a user that is scheduled for joining the group', async function () {
          await this.manager.$_grantGroup(GROUPS.SOME, user, 10, 0); // grant delay 10

          expect(await this.manager.hasGroup(GROUPS.SOME, user)).to.be.false;

          await expectRevertCustomError(
            this.manager.grantGroup(GROUPS.SOME, user, 0, { from: manager }),
            'AccessManagerAcountAlreadyInGroup',
            [GROUPS.SOME, user],
          );
        });

        it('grant group is restricted', async function () {
          await expectRevertCustomError(
            this.manager.grantGroup(GROUPS.SOME, user, 0, { from: other }),
            'AccessControlUnauthorizedAccount',
            [other, GROUPS.SOME_ADMIN],
          );
        });
      });

      describe('with a grant delay', function () {
        beforeEach(async function () {
          await this.manager.$_setGrantDelay(GROUPS.SOME, grantDelay);
        });

        it('granted group is not active immediatly', async function () {
          const { receipt } = await this.manager.grantGroup(GROUPS.SOME, user, 0, { from: manager });
          const timestamp = await clockFromReceipt.timestamp(receipt).then(web3.utils.toBN);
          expectEvent(receipt, 'GroupGranted', {
            groupId: GROUPS.SOME,
            account: user,
            since: timestamp.add(grantDelay),
            delay: '0',
          });

          expect(await this.manager.hasGroup(GROUPS.SOME, user)).to.be.false;

          const access = await this.manager.getAccess(GROUPS.SOME, user);
          expect(access[0]).to.be.bignumber.equal(timestamp.add(grantDelay)); // inGroupSince
          expect(access[1]).to.be.bignumber.equal('0'); // currentDelay
          expect(access[2]).to.be.bignumber.equal('0'); // pendingDelay
          expect(access[3]).to.be.bignumber.equal('0'); // effect
        });

        it('granted group is active after the delay', async function () {
          const { receipt } = await this.manager.grantGroup(GROUPS.SOME, user, 0, { from: manager });
          const timestamp = await clockFromReceipt.timestamp(receipt).then(web3.utils.toBN);
          expectEvent(receipt, 'GroupGranted', {
            groupId: GROUPS.SOME,
            account: user,
            since: timestamp.add(grantDelay),
            delay: '0',
          });

          await time.increase(grantDelay);

          expect(await this.manager.hasGroup(GROUPS.SOME, user)).to.be.true;

          const access = await this.manager.getAccess(GROUPS.SOME, user);
          expect(access[0]).to.be.bignumber.equal(timestamp.add(grantDelay)); // inGroupSince
          expect(access[1]).to.be.bignumber.equal('0'); // currentDelay
          expect(access[2]).to.be.bignumber.equal('0'); // pendingDelay
          expect(access[3]).to.be.bignumber.equal('0'); // effect
        });
      });
    });

    describe('revoke group', function () {
      it('from a user that is already in the group', async function () {
        expect(await this.manager.hasGroup(GROUPS.SOME, member)).to.be.true;

        const { receipt } = await this.manager.revokeGroup(GROUPS.SOME, member, { from: manager });
        expectEvent(receipt, 'GroupRevoked', { groupId: GROUPS.SOME, account: member });

        expect(await this.manager.hasGroup(GROUPS.SOME, member)).to.be.false;

        const access = await this.manager.getAccess(GROUPS.SOME, user);
        expect(access[0]).to.be.bignumber.equal('0'); // inGroupSince
        expect(access[1]).to.be.bignumber.equal('0'); // currentDelay
        expect(access[2]).to.be.bignumber.equal('0'); // pendingDelay
        expect(access[3]).to.be.bignumber.equal('0'); // effect
      });

      it('from a user that is scheduled for joining the group', async function () {
        await this.manager.$_grantGroup(GROUPS.SOME, user, 10, 0); // grant delay 10

        expect(await this.manager.hasGroup(GROUPS.SOME, user)).to.be.false;

        const { receipt } = await this.manager.revokeGroup(GROUPS.SOME, user, { from: manager });
        expectEvent(receipt, 'GroupRevoked', { groupId: GROUPS.SOME, account: user });

        expect(await this.manager.hasGroup(GROUPS.SOME, user)).to.be.false;

        const access = await this.manager.getAccess(GROUPS.SOME, user);
        expect(access[0]).to.be.bignumber.equal('0'); // inGroupSince
        expect(access[1]).to.be.bignumber.equal('0'); // currentDelay
        expect(access[2]).to.be.bignumber.equal('0'); // pendingDelay
        expect(access[3]).to.be.bignumber.equal('0'); // effect
      });

      it('from a user that is not in the group', async function () {
        expect(await this.manager.hasGroup(GROUPS.SOME, user)).to.be.false;

        await expectRevertCustomError(
          this.manager.revokeGroup(GROUPS.SOME, user, { from: manager }),
          'AccessManagerAcountNotInGroup',
          [GROUPS.SOME, user],
        );
      });

      it('revoke group is restricted', async function () {
        await expectRevertCustomError(
          this.manager.revokeGroup(GROUPS.SOME, member, { from: other }),
          'AccessControlUnauthorizedAccount',
          [other, GROUPS.SOME_ADMIN],
        );
      });
    });

    describe('renounce group', function () {
      it('for a user that is already in the group', async function () {
        expect(await this.manager.hasGroup(GROUPS.SOME, member)).to.be.true;

        const { receipt } = await this.manager.renounceGroup(GROUPS.SOME, member, { from: member });
        expectEvent(receipt, 'GroupRevoked', { groupId: GROUPS.SOME, account: member });

        expect(await this.manager.hasGroup(GROUPS.SOME, member)).to.be.false;

        const access = await this.manager.getAccess(GROUPS.SOME, member);
        expect(access[0]).to.be.bignumber.equal('0'); // inGroupSince
        expect(access[1]).to.be.bignumber.equal('0'); // currentDelay
        expect(access[2]).to.be.bignumber.equal('0'); // pendingDelay
        expect(access[3]).to.be.bignumber.equal('0'); // effect
      });

      it('for a user that is schedule for joining the group', async function () {
        await this.manager.$_grantGroup(GROUPS.SOME, user, 10, 0); // grant delay 10

        expect(await this.manager.hasGroup(GROUPS.SOME, user)).to.be.false;

        const { receipt } = await this.manager.renounceGroup(GROUPS.SOME, user, { from: user });
        expectEvent(receipt, 'GroupRevoked', { groupId: GROUPS.SOME, account: user });

        expect(await this.manager.hasGroup(GROUPS.SOME, user)).to.be.false;

        const access = await this.manager.getAccess(GROUPS.SOME, user);
        expect(access[0]).to.be.bignumber.equal('0'); // inGroupSince
        expect(access[1]).to.be.bignumber.equal('0'); // currentDelay
        expect(access[2]).to.be.bignumber.equal('0'); // pendingDelay
        expect(access[3]).to.be.bignumber.equal('0'); // effect
      });

      it('for a user that is not in the group', async function () {
        await expectRevertCustomError(
          this.manager.renounceGroup(GROUPS.SOME, user, { from: user }),
          'AccessManagerAcountNotInGroup',
          [GROUPS.SOME, user],
        );
      });

      it('bad user confirmation', async function () {
        await expectRevertCustomError(
          this.manager.renounceGroup(GROUPS.SOME, member, { from: user }),
          'AccessManagerBadConfirmation',
          [],
        );
      });
    });

    describe('change group admin', function () {
      it("admin can set any group's admin", async function () {
        expect(await this.manager.getGroupAdmin(GROUPS.SOME)).to.be.bignumber.equal(GROUPS.SOME_ADMIN);

        const { receipt } = await this.manager.setGroupAdmin(GROUPS.SOME, GROUPS.ADMIN, { from: admin });
        expectEvent(receipt, 'GroupAdminChanged', { groupId: GROUPS.SOME, admin: GROUPS.ADMIN });

        expect(await this.manager.getGroupAdmin(GROUPS.SOME)).to.be.bignumber.equal(GROUPS.ADMIN);
      });

      it("seeting a group's admin is restricted", async function () {
        await expectRevertCustomError(
          this.manager.setGroupAdmin(GROUPS.SOME, GROUPS.SOME, { from: manager }),
          'AccessControlUnauthorizedAccount',
          [manager, GROUPS.ADMIN],
        );
      });
    });

    describe('change group guardian', function () {
      it("admin can set any group's admin", async function () {
        expect(await this.manager.getGroupGuardian(GROUPS.SOME)).to.be.bignumber.equal(GROUPS.SOME_ADMIN);

        const { receipt } = await this.manager.setGroupGuardian(GROUPS.SOME, GROUPS.ADMIN, { from: admin });
        expectEvent(receipt, 'GroupGuardianChanged', { groupId: GROUPS.SOME, guardian: GROUPS.ADMIN });

        expect(await this.manager.getGroupGuardian(GROUPS.SOME)).to.be.bignumber.equal(GROUPS.ADMIN);
      });

      it("setting a group's admin is restricted", async function () {
        await expectRevertCustomError(
          this.manager.setGroupGuardian(GROUPS.SOME, GROUPS.SOME, { from: other }),
          'AccessControlUnauthorizedAccount',
          [other, GROUPS.ADMIN],
        );
      });
    });

    describe('change execution delay', function () {
      it('increassing the delay has immediate effect', async function () {
        const oldDelay = web3.utils.toBN(10);
        const newDelay = web3.utils.toBN(100);

        await this.manager.$_setExecuteDelay(GROUPS.SOME, member, oldDelay);

        const accessBefore = await this.manager.getAccess(GROUPS.SOME, member);
        expect(accessBefore[1]).to.be.bignumber.equal(oldDelay); // currentDelay
        expect(accessBefore[2]).to.be.bignumber.equal('0'); // pendingDelay
        expect(accessBefore[3]).to.be.bignumber.equal('0'); // effect

        const { receipt } = await this.manager.setExecuteDelay(GROUPS.SOME, member, newDelay, {
          from: manager,
        });
        const timestamp = await clockFromReceipt.timestamp(receipt).then(web3.utils.toBN);

        expectEvent(receipt, 'GroupExecutionDelayUpdated', {
          groupId: GROUPS.SOME,
          account: member,
          delay: newDelay,
          from: timestamp,
        });

        // immediate effect
        const accessAfter = await this.manager.getAccess(GROUPS.SOME, member);
        expect(accessAfter[1]).to.be.bignumber.equal(newDelay); // currentDelay
        expect(accessAfter[2]).to.be.bignumber.equal('0'); // pendingDelay
        expect(accessAfter[3]).to.be.bignumber.equal('0'); // effect
      });

      it('decreassing the delay takes time', async function () {
        const oldDelay = web3.utils.toBN(100);
        const newDelay = web3.utils.toBN(10);

        await this.manager.$_setExecuteDelay(GROUPS.SOME, member, oldDelay);

        const accessBefore = await this.manager.getAccess(GROUPS.SOME, member);
        expect(accessBefore[1]).to.be.bignumber.equal(oldDelay); // currentDelay
        expect(accessBefore[2]).to.be.bignumber.equal('0'); // pendingDelay
        expect(accessBefore[3]).to.be.bignumber.equal('0'); // effect

        const { receipt } = await this.manager.setExecuteDelay(GROUPS.SOME, member, newDelay, {
          from: manager,
        });
        const timestamp = await clockFromReceipt.timestamp(receipt).then(web3.utils.toBN);

        expectEvent(receipt, 'GroupExecutionDelayUpdated', {
          groupId: GROUPS.SOME,
          account: member,
          delay: newDelay,
          from: timestamp.add(oldDelay).sub(newDelay),
        });

        // delayed effect
        const accessAfter = await this.manager.getAccess(GROUPS.SOME, member);
        expect(accessAfter[1]).to.be.bignumber.equal(oldDelay); // currentDelay
        expect(accessAfter[2]).to.be.bignumber.equal(newDelay); // pendingDelay
        expect(accessAfter[3]).to.be.bignumber.equal(timestamp.add(oldDelay).sub(newDelay)); // effect
      });

      it('cannot set the delay of a non member', async function () {
        await expectRevertCustomError(
          this.manager.setExecuteDelay(GROUPS.SOME, other, executeDelay, { from: manager }),
          'AccessManagerAcountNotInGroup',
          [GROUPS.SOME, other],
        );
      });

      it('can set a user execution delay during the grant delay', async function () {
        await this.manager.$_grantGroup(GROUPS.SOME, other, 10, 0);

        const { receipt } = await this.manager.setExecuteDelay(GROUPS.SOME, other, executeDelay, { from: manager });
        const timestamp = await clockFromReceipt.timestamp(receipt).then(web3.utils.toBN);

        expectEvent(receipt, 'GroupExecutionDelayUpdated', {
          groupId: GROUPS.SOME,
          account: other,
          delay: executeDelay,
          from: timestamp,
        });
      });

      it('changing the execution delay is restricted', async function () {
        await expectRevertCustomError(
          this.manager.setExecuteDelay(GROUPS.SOME, member, executeDelay, { from: other }),
          'AccessControlUnauthorizedAccount',
          [GROUPS.SOME_ADMIN, other],
        );
      });
    });

    describe('change grant delay', function () {
      it('increassing the delay has immediate effect', async function () {
        const oldDelay = web3.utils.toBN(10);
        const newDelay = web3.utils.toBN(100);
        await this.manager.$_setGrantDelay(GROUPS.SOME, oldDelay);

        expect(await this.manager.getGroupGrantDelay(GROUPS.SOME)).to.be.bignumber.equal(oldDelay);

        const { receipt } = await this.manager.setGrantDelay(GROUPS.SOME, newDelay, { from: admin });
        const timestamp = await clockFromReceipt.timestamp(receipt).then(web3.utils.toBN);

        expectEvent(receipt, 'GroupGrantDelayChanged', { groupId: GROUPS.SOME, delay: newDelay, from: timestamp });

        expect(await this.manager.getGroupGrantDelay(GROUPS.SOME)).to.be.bignumber.equal(newDelay);
      });

      it('increassing the delay has delay effect', async function () {
        const oldDelay = web3.utils.toBN(100);
        const newDelay = web3.utils.toBN(10);
        await this.manager.$_setGrantDelay(GROUPS.SOME, oldDelay);

        expect(await this.manager.getGroupGrantDelay(GROUPS.SOME)).to.be.bignumber.equal(oldDelay);

        const { receipt } = await this.manager.setGrantDelay(GROUPS.SOME, newDelay, { from: admin });
        const timestamp = await clockFromReceipt.timestamp(receipt).then(web3.utils.toBN);

        expectEvent(receipt, 'GroupGrantDelayChanged', {
          groupId: GROUPS.SOME,
          delay: newDelay,
          from: timestamp.add(oldDelay).sub(newDelay),
        });

        expect(await this.manager.getGroupGrantDelay(GROUPS.SOME)).to.be.bignumber.equal(oldDelay);

        await time.increase(oldDelay.sub(newDelay));

        expect(await this.manager.getGroupGrantDelay(GROUPS.SOME)).to.be.bignumber.equal(newDelay);
      });

      it('changing the grant delay is restricted', async function () {
        await expectRevertCustomError(
          this.manager.setGrantDelay(GROUPS.SOME, grantDelay, { from: other }),
          'AccessControlUnauthorizedAccount',
          [GROUPS.ADMIN, other],
        );
      });
    });
  });

  describe('Mode management', function () {
    for (const [modeName, mode] of Object.entries(AccessMode)) {
      describe(`setContractMode${modeName}`, function () {
        it('set the mode and emits an event', async function () {
          // set the target to another mode, so we can check the effects
          await this.manager.$_setContractMode(
            this.target.address,
            Object.values(AccessMode).find(m => m != mode),
          );

          expect(await this.manager.getContractMode(this.target.address)).to.not.be.bignumber.equal(mode);

          expectEvent(
            await this.manager[`setContractMode${modeName}`](this.target.address, { from: admin }),
            'AccessModeUpdated',
            { target: this.target.address, mode },
          );

          expect(await this.manager.getContractMode(this.target.address)).to.be.bignumber.equal(mode);
        });

        it('is restricted', async function () {
          await expectRevertCustomError(
            this.manager[`setContractMode${modeName}`](this.target.address, { from: other }),
            'AccessControlUnauthorizedAccount',
            [other, GROUPS.ADMIN],
          );
        });
      });
    }
  });

  describe('Change function permissions', function () {
    const sigs = ['someFunction()', 'someOtherFunction(uint256)', 'oneMoreFunction(address,uint8)'].map(selector);

    it('admin can set function allowed group', async function () {
      for (const sig of sigs) {
        expect(await this.manager.getFunctionAllowedGroup(this.target.address, sig)).to.be.bignumber.equal(
          GROUPS.ADMIN,
        );
      }

      const { receipt: receipt1 } = await this.manager.setFunctionAllowedGroup(this.target.address, sigs, GROUPS.SOME, {
        from: admin,
      });

      for (const sig of sigs) {
        expectEvent(receipt1, 'FunctionAllowedGroupUpdated', {
          target: this.target.address,
          selector: sig,
          groupId: GROUPS.SOME,
        });
        expect(await this.manager.getFunctionAllowedGroup(this.target.address, sig)).to.be.bignumber.equal(GROUPS.SOME);
      }

      const { receipt: receipt2 } = await this.manager.setFunctionAllowedGroup(
        this.target.address,
        [sigs[1]],
        GROUPS.SOME_ADMIN,
        { from: admin },
      );
      expectEvent(receipt2, 'FunctionAllowedGroupUpdated', {
        target: this.target.address,
        selector: sigs[1],
        groupId: GROUPS.SOME_ADMIN,
      });

      for (const sig of sigs) {
        expect(await this.manager.getFunctionAllowedGroup(this.target.address, sig)).to.be.bignumber.equal(
          sig == sigs[1] ? GROUPS.SOME_ADMIN : GROUPS.SOME,
        );
      }
    });

    it('changing function permissions is restricted', async function () {
      await expectRevertCustomError(
        this.manager.setFunctionAllowedGroup(this.target.address, sigs, GROUPS.SOME, { from: other }),
        'AccessControlUnauthorizedAccount',
        [other, GROUPS.ADMIN],
      );
    });
  });

  describe('Calling restricted & unrestricted functions', function () {
    const product = (...arrays) => arrays.reduce((a, b) => a.flatMap(ai => b.map(bi => [ai, bi].flat())));

    for (const [callerOpt, targetOpt] of product(
      [
        { groups: [] },
        { groups: [GROUPS.SOME] },
        { groups: [GROUPS.SOME], delay: executeDelay },
        { groups: [GROUPS.SOME, GROUPS.PUBLIC], delay: executeDelay },
      ],
      [
        { mode: AccessMode.Open },
        { mode: AccessMode.Closed },
        { mode: AccessMode.Custom, group: GROUPS.ADMIN },
        { mode: AccessMode.Custom, group: GROUPS.SOME },
        { mode: AccessMode.Custom, group: GROUPS.PUBLIC },
      ],
    )) {
      const public =
        targetOpt.mode == AccessMode.Open || (targetOpt.mode == AccessMode.Custom && targetOpt.group == GROUPS.PUBLIC);

      // can we call with a delay ?
      const indirectSuccess =
        public || (targetOpt.mode == AccessMode.Custom && callerOpt.groups?.includes(targetOpt.group));

      // can we call without a delay ?
      const directSuccess =
        public ||
        (targetOpt.mode == AccessMode.Custom && callerOpt.groups?.includes(targetOpt.group) && !callerOpt.delay);

      const description = [
        'Caller in groups',
        '[' + (callerOpt.groups ?? []).map(groupId => GROUPS[groupId]).join(', ') + ']',
        callerOpt.delay ? 'with a delay' : 'without a delay',
        '+',
        'contract in mode',
        Object.keys(AccessMode)[targetOpt.mode.toNumber()],
        targetOpt.mode == AccessMode.Custom ? `(${GROUPS[targetOpt.group]})` : '',
      ].join(' ');

      describe(description, function () {
        beforeEach(async function () {
          // setup
          await Promise.all([
            this.manager.$_setContractMode(this.target.address, targetOpt.mode),
            targetOpt.group &&
              this.manager.$_setFunctionAllowedGroup(this.target.address, selector('fnRestricted()'), targetOpt.group),
            targetOpt.group &&
              this.manager.$_setFunctionAllowedGroup(
                this.target.address,
                selector('fnUnrestricted()'),
                targetOpt.group,
              ),
            ...(callerOpt.groups ?? [])
              .filter(groupId => groupId != GROUPS.PUBLIC)
              .map(groupId => this.manager.$_grantGroup(groupId, user, 0, callerOpt.delay ?? 0)),
          ]);

          // post setup checks
          expect(await this.manager.getContractMode(this.target.address)).to.be.bignumber.equal(targetOpt.mode);
          if (targetOpt.group) {
            expect(
              await this.manager.getFunctionAllowedGroup(this.target.address, selector('fnRestricted()')),
            ).to.be.bignumber.equal(targetOpt.group);
            expect(
              await this.manager.getFunctionAllowedGroup(this.target.address, selector('fnUnrestricted()')),
            ).to.be.bignumber.equal(targetOpt.group);
          }
          for (const groupId of callerOpt.groups ?? []) {
            const access = await this.manager.getAccess(groupId, user);
            if (groupId == GROUPS.PUBLIC) {
              expect(access[0]).to.be.bignumber.equal('0'); // inGroupSince
              expect(access[1]).to.be.bignumber.equal('0'); // currentDelay
              expect(access[2]).to.be.bignumber.equal('0'); // pendingDelay
              expect(access[3]).to.be.bignumber.equal('0'); // effect
            } else {
              expect(access[0]).to.be.bignumber.gt('0'); // inGroupSince
              expect(access[1]).to.be.bignumber.eq(String(callerOpt.delay ?? 0)); // currentDelay
              expect(access[2]).to.be.bignumber.equal('0'); // pendingDelay
              expect(access[3]).to.be.bignumber.equal('0'); // effect
            }
          }
        });

        it('canCall', async function () {
          const result = await this.manager.canCall(user, this.target.address, selector('fnRestricted()'));
          expect(result[0]).to.be.equal(directSuccess);
          expect(result[1]).to.be.bignumber.equal(!directSuccess && indirectSuccess ? callerOpt.delay ?? '0' : '0');
        });

        it('Calling a non restricted function never revert', async function () {
          expectEvent(await this.target.fnUnrestricted({ from: user }), 'CalledUnrestricted', {
            caller: user,
          });
        });

        it(`Calling a restricted function directly should ${directSuccess ? 'succeed' : 'revert'}`, async function () {
          const promise = this.direct();

          if (directSuccess) {
            expectEvent(await promise, 'CalledRestricted', { caller: user });
          } else if (indirectSuccess) {
            await expectRevertCustomError(promise, 'AccessManagerNotScheduled', [this.opId]);
          } else {
            await expectRevertCustomError(promise, 'AccessManagedUnauthorized', [user]);
          }
        });

        it('Calling indirectly: only relay', async function () {
          // relay without schedule
          if (directSuccess) {
            const { receipt, tx } = await this.relay();
            expectEvent.notEmitted(receipt, 'Executed', { operationId: this.opId });
            await expectEvent.inTransaction(tx, this.target, 'CalledRestricted', { caller: this.manager.address });
          } else if (indirectSuccess) {
            await expectRevertCustomError(this.relay(), 'AccessManagerNotScheduled', [this.opId]);
          } else {
            await expectRevertCustomError(this.relay(), 'AccessManagerUnauthorizedCall', [user, ...this.call]);
          }
        });

        it('Calling indirectly: schedule and relay', async function () {
          if (directSuccess || indirectSuccess) {
            const { receipt } = await this.schedule();
            const timestamp = await clockFromReceipt.timestamp(receipt).then(web3.utils.toBN);

            expectEvent(receipt, 'Scheduled', {
              operationId: this.opId,
              caller: user,
              target: this.call[0],
              data: this.call[1],
            });

            // if can call directly, delay should be 0. Otherwize, the delay should be applied
            expect(await this.manager.getSchedule(this.opId)).to.be.bignumber.equal(
              timestamp.add(directSuccess ? web3.utils.toBN(0) : callerOpt.delay),
            );

            // execute without wait
            if (directSuccess) {
              const { receipt, tx } = await this.relay();
              expectEvent(receipt, 'Executed', { operationId: this.opId });
              await expectEvent.inTransaction(tx, this.target, 'CalledRestricted', { caller: this.manager.address });

              expect(await this.manager.getSchedule(this.opId)).to.be.bignumber.equal('0');
            } else if (indirectSuccess) {
              await expectRevertCustomError(this.relay(), 'AccessManagerNotReady', [this.opId]);
            } else {
              await expectRevertCustomError(this.relay(), 'AccessManagerUnauthorizedCall', [user, ...this.call]);
            }
          } else {
            await expectRevertCustomError(this.schedule(), 'AccessManagerUnauthorizedCall', [user, ...this.call]);
          }
        });

        it('Calling indirectly: schedule wait and relay', async function () {
          if (directSuccess || indirectSuccess) {
            const { receipt } = await this.schedule();
            const timestamp = await clockFromReceipt.timestamp(receipt).then(web3.utils.toBN);

            expectEvent(receipt, 'Scheduled', {
              operationId: this.opId,
              caller: user,
              target: this.call[0],
              data: this.call[1],
            });

            // if can call directly, delay should be 0. Otherwize, the delay should be applied
            expect(await this.manager.getSchedule(this.opId)).to.be.bignumber.equal(
              timestamp.add(directSuccess ? web3.utils.toBN(0) : callerOpt.delay),
            );

            // wait
            await time.increase(callerOpt.delay ?? 0);

            // execute without wait
            if (directSuccess || indirectSuccess) {
              const { receipt, tx } = await this.relay();
              expectEvent(receipt, 'Executed', { operationId: this.opId });
              await expectEvent.inTransaction(tx, this.target, 'CalledRestricted', { caller: this.manager.address });

              expect(await this.manager.getSchedule(this.opId)).to.be.bignumber.equal('0');
            } else {
              await expectRevertCustomError(this.relay(), 'AccessManagerUnauthorizedCall', [user, ...this.call]);
            }
          } else {
            await expectRevertCustomError(this.schedule(), 'AccessManagerUnauthorizedCall', [user, ...this.call]);
          }
        });

        it('Calling directly: schedule and call', async function () {
          if (directSuccess || indirectSuccess) {
            const { receipt } = await this.schedule();
            const timestamp = await clockFromReceipt.timestamp(receipt).then(web3.utils.toBN);

            expectEvent(receipt, 'Scheduled', {
              operationId: this.opId,
              caller: user,
              target: this.call[0],
              data: this.call[1],
            });

            // if can call directly, delay should be 0. Otherwize, the delay should be applied
            const schedule = timestamp.add(directSuccess ? web3.utils.toBN(0) : callerOpt.delay);
            expect(await this.manager.getSchedule(this.opId)).to.be.bignumber.equal(schedule);

            // execute without wait
            const promise = this.direct();
            if (directSuccess) {
              expectEvent(await promise, 'CalledRestricted', { caller: user });

              // schedule is not reset
              expect(await this.manager.getSchedule(this.opId)).to.be.bignumber.equal(schedule);
            } else if (indirectSuccess) {
              await expectRevertCustomError(promise, 'AccessManagerNotReady', [this.opId]);
            } else {
              await expectRevertCustomError(promise, 'AccessManagerUnauthorizedCall', [user, ...this.call]);
            }
          } else {
            await expectRevertCustomError(this.schedule(), 'AccessManagerUnauthorizedCall', [user, ...this.call]);
          }
        });

        it('Calling directly: schedule wait and call', async function () {
          if (directSuccess || indirectSuccess) {
            const { receipt } = await this.schedule();
            const timestamp = await clockFromReceipt.timestamp(receipt).then(web3.utils.toBN);

            expectEvent(receipt, 'Scheduled', {
              operationId: this.opId,
              caller: user,
              target: this.call[0],
              data: this.call[1],
            });

            // if can call directly, delay should be 0. Otherwize, the delay should be applied
            const schedule = timestamp.add(directSuccess ? web3.utils.toBN(0) : callerOpt.delay);
            expect(await this.manager.getSchedule(this.opId)).to.be.bignumber.equal(schedule);

            // wait
            await time.increase(callerOpt.delay ?? 0);

            // execute without wait
            const promise = await this.direct();
            if (directSuccess) {
              expectEvent(await promise, 'CalledRestricted', { caller: user });

              // schedule is not reset
              expect(await this.manager.getSchedule(this.opId)).to.be.bignumber.equal(schedule);
            } else if (indirectSuccess) {
              const receipt = await promise;

              expectEvent(receipt, 'CalledRestricted', { caller: user });
              await expectEvent.inTransaction(receipt.tx, this.manager, 'Executed', { operationId: this.opId });

              // schedule is reset
              expect(await this.manager.getSchedule(this.opId)).to.be.bignumber.equal('0');
            } else {
              await expectRevertCustomError(this.direct(), 'AccessManagerUnauthorizedCall', [user, ...this.call]);
            }
          } else {
            await expectRevertCustomError(this.schedule(), 'AccessManagerUnauthorizedCall', [user, ...this.call]);
          }
        });

        it('Scheduling for later than needed'); // TODO
      });
    }
  });

  describe('Indirect execution corner-cases', async function () {
    beforeEach(async function () {
      await this.manager.$_setFunctionAllowedGroup(...this.call, GROUPS.SOME);
      await this.manager.$_grantGroup(GROUPS.SOME, user, 0, executeDelay);
    });

    it('Checking canCall when caller is the manager depend on the _relayIdentifier', async function () {
      expect(await this.manager.getContractMode(this.target.address)).to.be.bignumber.equal(AccessMode.Custom);

      const result = await this.manager.canCall(this.manager.address, this.target.address, '0x00000000');
      expect(result[0]).to.be.false;
      expect(result[1]).to.be.bignumber.equal('0');
    });

    it('Cannot execute earlier', async function () {
      const { receipt } = await this.schedule();
      const timestamp = await clockFromReceipt.timestamp(receipt).then(web3.utils.toBN);

      expect(await this.manager.getSchedule(this.opId)).to.be.bignumber.equal(timestamp.add(executeDelay));

      // we need to set the clock 2 seconds before the value, because the increaseTo "consumes" the timestamp
      // and the next transaction will be one after that (see check bellow)
      await time.increaseTo(timestamp.add(executeDelay).subn(2));

      // too early
      await expectRevertCustomError(this.relay(), 'AccessManagerNotReady', [this.opId]);

      // the revert happened one second before the execution delay expired
      expect(await time.latest()).to.be.bignumber.equal(timestamp.add(executeDelay).subn(1));

      // ok
      await this.relay();

      // the success happened when the delay was reached (earliest possible)
      expect(await time.latest()).to.be.bignumber.equal(timestamp.add(executeDelay));
    });

    it('Cannot schedule an already scheduled operation', async function () {
      const { receipt } = await this.schedule();
      expectEvent(receipt, 'Scheduled', {
        operationId: this.opId,
        caller: user,
        target: this.call[0],
        data: this.call[1],
      });

      await expectRevertCustomError(this.schedule(), 'AccessManagerAlreadyScheduled', [this.opId]);
    });

    it('Cannot cancel an operation that is not scheduled', async function () {
      await expectRevertCustomError(this.cancel(), 'AccessManagerNotScheduled', [this.opId]);
    });

    it('Cannot cancel an operation that is not already relayed', async function () {
      await this.schedule();
      await time.increase(executeDelay);
      await this.relay();

      await expectRevertCustomError(this.cancel(), 'AccessManagerNotScheduled', [this.opId]);
    });

    it('Scheduler can cancel', async function () {
      await this.schedule();

      expect(await this.manager.getSchedule(this.opId)).to.not.be.bignumber.equal('0');

      expectEvent(await this.cancel({ from: manager }), 'Canceled', { operationId: this.opId });

      expect(await this.manager.getSchedule(this.opId)).to.be.bignumber.equal('0');
    });

    it('Guardian can cancel', async function () {
      await this.schedule();

      expect(await this.manager.getSchedule(this.opId)).to.not.be.bignumber.equal('0');

      expectEvent(await this.cancel({ from: manager }), 'Canceled', { operationId: this.opId });

      expect(await this.manager.getSchedule(this.opId)).to.be.bignumber.equal('0');
    });

    it('Cancel is restricted', async function () {
      await this.schedule();

      expect(await this.manager.getSchedule(this.opId)).to.not.be.bignumber.equal('0');

      await expectRevertCustomError(this.cancel({ from: other }), 'AccessManagerCannotCancel', [
        other,
        user,
        ...this.call,
      ]);

      expect(await this.manager.getSchedule(this.opId)).to.not.be.bignumber.equal('0');
    });

    it('Can re-schedule after execution', async function () {
      await this.schedule();
      await time.increase(executeDelay);
      await this.relay();

      // reschedule
      const { receipt } = await this.schedule();
      expectEvent(receipt, 'Scheduled', {
        operationId: this.opId,
        caller: user,
        target: this.call[0],
        data: this.call[1],
      });
    });

    it('Can re-schedule after cancel', async function () {
      await this.schedule();
      await this.cancel();

      // reschedule
      const { receipt } = await this.schedule();
      expectEvent(receipt, 'Scheduled', {
        operationId: this.opId,
        caller: user,
        target: this.call[0],
        data: this.call[1],
      });
    });
  });

  describe('authority update', function () {
    beforeEach(async function () {
      this.newManager = await AccessManager.new(admin);
    });

    it('admin can change authority', async function () {
      expect(await this.target.authority()).to.be.equal(this.manager.address);

      const { tx } = await this.manager.updateAuthority(this.target.address, this.newManager.address, { from: admin });
      await expectEvent.inTransaction(tx, this.target, 'AuthorityUpdated', { authority: this.newManager.address });

      expect(await this.target.authority()).to.be.equal(this.newManager.address);
    });

    it('cannot set an address without code as the authority', async function () {
      await expectRevertCustomError(
        this.manager.updateAuthority(this.target.address, user, { from: admin }),
        'AccessManagedInvalidAuthority',
        [user],
      );
    });

    it('updateAuthority is restricted on manager', async function () {
      await expectRevertCustomError(
        this.manager.updateAuthority(this.target.address, this.newManager.address, { from: other }),
        'AccessControlUnauthorizedAccount',
        [other, GROUPS.ADMIN],
      );
    });

    it('setAuthority is restricted on AccessManaged', async function () {
      await expectRevertCustomError(
        this.target.setAuthority(this.newManager.address, { from: admin }),
        'AccessManagedUnauthorized',
        [admin],
      );
    });
  });

  // TODO: test all admin functions
  describe('admin delays', function () {
    const delay = '1000';

    beforeEach('set admin delay', async function () {
      this.adminSelector = selector('setContractModeOpen(address)');

      this.tx = await this.manager.setAdminFunctionDelay(this.adminSelector, delay, { from: admin });

      this.data = this.manager.contract.methods.setContractModeOpen(this.target.address).encodeABI();
      this.opId = web3.utils.keccak256(
        web3.eth.abi.encodeParameters(['address', 'address', 'bytes'], [admin, this.manager.address, this.data]),
      );
    });

    it('emits event', async function () {
      const from = await clockFromReceipt.timestamp(this.tx.receipt).then(web3.utils.toBN);
      expectEvent(this.tx.receipt, 'AdminDelayUpdated', { selector: this.adminSelector, delay, from });
    });

    it('without prior scheduling: reverts', async function () {
      await expectRevertCustomError(
        this.manager.setContractModeOpen(this.target.address, { from: admin }),
        'AccessManagerNotScheduled',
        [this.opId],
      );
    });

    describe('with prior scheduling', async function () {
      beforeEach('schedule', async function () {
        await this.manager.schedule(this.manager.address, this.data, 0, { from: admin });
      });

      it('without delay: reverts', async function () {
        await expectRevertCustomError(
          this.manager.setContractModeOpen(this.target.address, { from: admin }),
          'AccessManagerNotReady',
          [this.opId],
        );
      });

      it('with delay: succeeds', async function () {
        await time.increase(delay);
        await this.manager.setContractModeOpen(this.target.address, { from: admin });
      });
    });
  });
});