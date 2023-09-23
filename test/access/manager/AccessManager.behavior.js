const { time } = require('@openzeppelin/test-helpers');
const {
  time: { setNextBlockTimestamp },
  setStorageAt,
  mine,
} = require('@nomicfoundation/hardhat-network-helpers');
const { impersonate } = require('../../helpers/account');
const { expectRevertCustomError } = require('../../helpers/customError');
const { EXPIRATION } = require('../../helpers/access-manager');

// ============ COMMON PATHS ============

const COMMON_IS_EXECUTING_PATH = {
  executing: function () {
    it('succeeds', async function () {
      await web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller });
    });
  },
  notExecuting: function () {
    it('reverts as AccessManagerUnauthorizedAccount', async function () {
      await expectRevertCustomError(
        web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller }),
        'AccessManagerUnauthorizedAccount',
        [this.caller, this.role.id],
      );
    });
  },
};

const COMMON_GET_ACCESS_PATH = {
  roleGranted: {
    roleWithGrantDelay: {
      callerWithExecutionDelay: {
        before: function () {
          it('reverts as AccessManagerUnauthorizedAccount', async function () {
            await expectRevertCustomError(
              web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller }),
              'AccessManagerUnauthorizedAccount',
              [this.caller, this.role.id],
            );
          });
        },
        after: undefined, // Diverges if there's an operation delay or not
      },
      callerWithoutExecutionDelay: {
        before: function () {
          it('reverts as AccessManagerUnauthorizedAccount', async function () {
            await expectRevertCustomError(
              web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller }),
              'AccessManagerUnauthorizedAccount',
              [this.caller, this.role.id],
            );
          });
        },
        after: function () {
          it('succeeds', async function () {
            await web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller });
          });
        },
      },
    },
    roleWithoutGrantDelay: {
      callerWithExecutionDelay: undefined, // Diverges if there's an operation to schedule or not
      callerWithoutExecutionDelay: function () {
        it('succeeds', async function () {
          await web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller });
        });
      },
    },
  },
  roleNotGranted: function () {
    it('reverts as AccessManagerUnauthorizedAccount', async function () {
      await expectRevertCustomError(
        web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller }),
        'AccessManagerUnauthorizedAccount',
        [this.caller, this.role.id],
      );
    });
  },
};

const COMMON_SCHEDULABLE_PATH = {
  scheduled: {
    before: function () {
      it('reverts as AccessManagerNotReady', async function () {
        await expectRevertCustomError(
          web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller }),
          'AccessManagerNotReady',
          [this.operationId],
        );
      });
    },
    after: function () {
      it('succeeds', async function () {
        await web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller });
      });
    },
    expired: function () {
      it('reverts as AccessManagerExpired', async function () {
        await expectRevertCustomError(
          web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller }),
          'AccessManagerExpired',
          [this.operationId],
        );
      });
    },
  },
  notScheduled: function () {
    it('reverts as AccessManagerNotScheduled', async function () {
      await expectRevertCustomError(
        web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller }),
        'AccessManagerNotScheduled',
        [this.operationId],
      );
    });
  },
};

// ============ MODE HELPERS ============

/**
 * @requires this.{manager,target}
 */
function shouldBehaveLikeClosable({ closed, open }) {
  describe('when the manager is closed', function () {
    beforeEach('close', async function () {
      await this.manager.$_setTargetClosed(this.target.address, true);
    });

    closed();
  });

  describe('when the manager is open', function () {
    beforeEach('open', async function () {
      await this.manager.$_setTargetClosed(this.target.address, false);
    });

    open();
  });
}

// ============ DELAY HELPERS ============

/**
 * @requires this.{delay}
 */
function shouldBehaveLikeDelay(type, { before, after }) {
  beforeEach('define timestamp when delay takes effect', async function () {
    const timestamp = await time.latest();
    this.delayEffect = timestamp.add(this.delay);
  });

  describe(`when ${type} delay has not taken effect yet`, function () {
    beforeEach(`set next block timestamp before ${type} takes effect`, async function () {
      await setNextBlockTimestamp(this.delayEffect.subn(1));
    });

    before();
  });

  describe(`when ${type} delay has taken effect`, function () {
    beforeEach(`set next block timestamp when ${type} takes effect`, async function () {
      await setNextBlockTimestamp(this.delayEffect);
    });

    after();
  });
}

// ============ OPERATION HELPERS ============

/**
 * @requires this.{manager,scheduleIn,caller,target,calldata}
 */
function shouldBehaveLikeSchedulableOperation({ scheduled: { before, after, expired }, notScheduled }) {
  describe('when operation is scheduled', function () {
    beforeEach('schedule operation', async function () {
      const { operationId } = await scheduleOperation(this.manager, {
        caller: this.caller,
        target: this.target.address,
        calldata: this.calldata,
        delay: this.scheduleIn,
      });
      this.operationId = operationId;
    });

    describe('when operation is not ready for execution', function () {
      beforeEach('set next block time before operation is ready', async function () {
        this.scheduledAt = await time.latest();
        const schedule = await this.manager.getSchedule(this.operationId);
        await setNextBlockTimestamp(schedule.subn(1));
      });

      before();
    });

    describe('when operation is ready for executuon', function () {
      beforeEach('set next block time when operation is ready for execution', async function () {
        this.scheduledAt = await time.latest();
        const schedule = await this.manager.getSchedule(this.operationId);
        await setNextBlockTimestamp(schedule);
      });

      after();
    });

    describe('when operation has expired', function () {
      beforeEach('set next block time when operation expired', async function () {
        this.scheduledAt = await time.latest();
        const schedule = await this.manager.getSchedule(this.operationId);
        await setNextBlockTimestamp(schedule.add(EXPIRATION));
      });

      expired();
    });
  });

  describe('when operation is not scheduled', function () {
    beforeEach('set expected operationId', async function () {
      this.operationId = await this.manager.hashOperation(this.caller, this.target.address, this.calldata);

      // Assert operation is not scheduled
      expect(await this.manager.getSchedule(this.operationId)).to.be.bignumber.equal(web3.utils.toBN(0));
    });

    notScheduled();
  });
}

/**
 * @requires this.{manager,roles,target,calldata}
 */
function shouldBehaveLikeARestrictedOperation({ externalCaller, managerCaller }) {
  describe('when the call comes from the manager (msg.sender == manager)', function () {
    beforeEach('define caller as manager', async function () {
      this.caller = this.manager.address;
      await impersonate(this.caller);
    });

    shouldBehaveLikeCanCallExecuting(managerCaller);
  });

  describe('when the call does not come from the manager (msg.sender != manager)', function () {
    beforeEach('define non manager caller', function () {
      this.caller = this.roles.SOME.members[0];
    });

    externalCaller();
  });
}

/**
 * @requires this.{manager,roles,executionDelay,operationDelay,target}
 */
function shouldBehaveLikeDelayedOperation() {
  describe('with operation delay', function () {
    describe('when operation delay is greater than execution delay', function () {
      beforeEach('set operation delay', async function () {
        this.operationDelay = this.executionDelay.add(time.duration.hours(1));
        await this.manager.$_setTargetAdminDelay(this.target.address, this.operationDelay);
        this.scheduleIn = this.operationDelay; // For shouldBehaveLikeSchedulableOperation
      });

      shouldBehaveLikeSchedulableOperation(COMMON_SCHEDULABLE_PATH);
    });

    describe('when operation delay is shorter than execution delay', function () {
      beforeEach('set operation delay', async function () {
        this.operationDelay = this.executionDelay.sub(time.duration.hours(1));
        await this.manager.$_setTargetAdminDelay(this.target.address, this.operationDelay);
        this.scheduleIn = this.executionDelay; // For shouldBehaveLikeSchedulableOperation
      });

      shouldBehaveLikeSchedulableOperation(COMMON_SCHEDULABLE_PATH);
    });
  });

  describe('without operation delay', function () {
    beforeEach('set operation delay', async function () {
      this.operationDelay = web3.utils.toBN(0);
      await this.manager.$_setTargetAdminDelay(this.target.address, this.operationDelay);
      this.scheduleIn = this.executionDelay; // For shouldBehaveLikeSchedulableOperation
    });

    shouldBehaveLikeSchedulableOperation(COMMON_SCHEDULABLE_PATH);
  });
}

// ============ METHOD HELPERS ============

/**
 * @requires this.{manager,roles,target,calldata}
 */
function shouldBehaveLikeCanCall({
  closed,
  open: {
    managerCaller,
    externalCaller: { requiredPublicRole, notRequiredPublicRole },
  },
}) {
  shouldBehaveLikeClosable({
    closed,
    open: function () {
      shouldBehaveLikeARestrictedOperation({
        managerCaller,
        externalCaller: function () {
          shouldBehaveLikeHasRole({
            requiredPublicRole,
            notRequiredPublicRole,
          });
        },
      });
    },
  });
}

/**
 * @requires this.{target,calldata}
 */
function shouldBehaveLikeCanCallExecuting({ executing, notExecuting }) {
  describe('when _executionId is in storage for target and selector', function () {
    beforeEach('set _executionId flag from calldata and target', async function () {
      const executionId = await web3.utils.keccak256(
        web3.eth.abi.encodeParameters(['address', 'bytes4'], [this.target.address, this.calldata.substring(0, 10)]),
      );
      await setStorageAt(this.manager.address, 3, executionId);
    });

    executing();
  });

  describe('when _executionId does not match target and selector', notExecuting);
}

/**
 * @requires this.{target,calldata,roles,role}
 */
function shouldBehaveLikeHasRole({ requiredPublicRole, notRequiredPublicRole }) {
  describe('when the function requires the caller to be granted with the PUBLIC_ROLE', function () {
    beforeEach('set target function role as PUBLIC_ROLE', async function () {
      this.role = this.roles.PUBLIC;
      await this.manager.$_setTargetFunctionRole(this.target.address, this.calldata.substring(0, 10), this.role.id, {
        from: this.roles.ADMIN.members[0],
      });
    });

    requiredPublicRole();
  });

  describe('when the function requires the caller to be granted with a role other than PUBLIC_ROLE', function () {
    beforeEach('set target function role as PUBLIC_ROLE', async function () {
      await this.manager.$_setTargetFunctionRole(this.target.address, this.calldata.substring(0, 10), this.role.id, {
        from: this.roles.ADMIN.members[0],
      });
    });

    shouldBehaveLikeGetAccess(notRequiredPublicRole);
  });
}

/**
 * @requires this.{manager,role,caller}
 */
function shouldBehaveLikeGetAccess({
  roleGranted: {
    roleWithGrantDelay: { callerWithExecutionDelay: case1, callerWithoutExecutionDelay: case2 },
    roleWithoutGrantDelay: { callerWithExecutionDelay: case3, callerWithoutExecutionDelay: case4 },
  },
  roleNotGranted,
}) {
  describe('when the required role is granted to the caller', function () {
    describe('when role granting is delayed', function () {
      beforeEach('define delay', function () {
        this.grantDelay = time.duration.minutes(3);
        this.delay = this.grantDelay; // For shouldBehaveLikeDelay
      });

      describe('when caller has an execution delay', function () {
        beforeEach('set role and delay', async function () {
          this.executionDelay = time.duration.hours(10);
          this.delay = this.grantDelay;
          await this.manager.$_grantRole(this.role.id, this.caller, this.grantDelay, this.executionDelay);
        });

        shouldBehaveLikeDelay('grant', case1);
      });

      describe('when caller has no execution delay', function () {
        beforeEach('set role and delay', async function () {
          this.executionDelay = web3.utils.toBN(0);
          await this.manager.$_grantRole(this.role.id, this.caller, this.grantDelay, this.executionDelay);
        });

        shouldBehaveLikeDelay('grant', case2);
      });
    });

    describe('when role granting is not delayed', function () {
      beforeEach('define delay', function () {
        this.grantDelay = web3.utils.toBN(0);
      });

      describe('when caller has an execution delay', function () {
        beforeEach('set role and delay', async function () {
          this.executionDelay = time.duration.hours(10);
          await this.manager.$_grantRole(this.role.id, this.caller, this.grantDelay, this.executionDelay);
        });

        case3();
      });

      describe('when caller has no execution delay', function () {
        beforeEach('set role and delay', async function () {
          this.executionDelay = web3.utils.toBN(0);
          await this.manager.$_grantRole(this.role.id, this.caller, this.grantDelay, this.executionDelay);
        });

        case4();
      });
    });
  });

  describe('when role is not granted', function () {
    // Because this helper can be composed with other helpers, it's possible
    // that role has been set already by another helper.
    // Although this is highly unlikely, we check for it here to avoid false positives.
    beforeEach('assert role is unset', async function () {
      const { since } = await this.manager.getAccess(this.role.id, this.caller);
      expect(since).to.be.bignumber.equal(web3.utils.toBN(0));
    });

    roleNotGranted();
  });
}

// ============ ADMIN OPERATION HELPERS ============

/**
 * @requires this.{manager,roles,calldata,role}
 */
function shouldBehaveLikeDelayedAdminOperation() {
  const getAccessPath = COMMON_GET_ACCESS_PATH;
  getAccessPath.roleGranted.roleWithGrantDelay.callerWithExecutionDelay.after = function () {
    beforeEach('consume previously set grant delay', async function () {
      // Consume previously set delay
      await mine();
    });
    shouldBehaveLikeDelayedOperation();
  };
  getAccessPath.roleGranted.roleWithoutGrantDelay.callerWithExecutionDelay = function () {
    beforeEach('set execution delay', async function () {
      this.scheduleIn = this.executionDelay; // For shouldBehaveLikeDelayedOperation
    });
    shouldBehaveLikeSchedulableOperation(COMMON_SCHEDULABLE_PATH);
  };

  beforeEach('set target as manager', function () {
    this.target = this.manager;
  });

  shouldBehaveLikeARestrictedOperation({
    managerCaller: COMMON_IS_EXECUTING_PATH,
    externalCaller: function () {
      shouldBehaveLikeHasRole({
        requiredPublicRole: function () {
          it('reverts as AccessManagerUnauthorizedAccount', async function () {
            await expectRevertCustomError(
              web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller }),
              'AccessManagerUnauthorizedAccount',
              [
                this.caller,
                this.roles.ADMIN.id, // Although PUBLIC is required, target function role doesn't apply to admin ops
              ],
            );
          });
        },
        notRequiredPublicRole: getAccessPath,
      });
    },
  });
}

/**
 * @requires this.{manager,roles,calldata,role}
 */
function shouldBehaveLikeNotDelayedAdminOperation() {
  const getAccessPath = COMMON_GET_ACCESS_PATH;
  getAccessPath.roleGranted.roleWithGrantDelay.callerWithExecutionDelay.after = function () {
    beforeEach('set execution delay', async function () {
      await mine();
      this.scheduleIn = this.executionDelay; // For shouldBehaveLikeSchedulableOperation
    });
    shouldBehaveLikeSchedulableOperation(COMMON_SCHEDULABLE_PATH);
  };
  getAccessPath.roleGranted.roleWithoutGrantDelay.callerWithExecutionDelay = function () {
    beforeEach('set execution delay', async function () {
      this.scheduleIn = this.executionDelay; // For shouldBehaveLikeSchedulableOperation
    });
    shouldBehaveLikeSchedulableOperation(COMMON_SCHEDULABLE_PATH);
  };

  beforeEach('set target as manager', function () {
    this.target = this.manager;
  });

  shouldBehaveLikeARestrictedOperation({
    managerCaller: COMMON_IS_EXECUTING_PATH,
    externalCaller: function () {
      shouldBehaveLikeHasRole({
        requiredPublicRole: function () {
          it('reverts as AccessManagerUnauthorizedAccount', async function () {
            await expectRevertCustomError(
              web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller }),
              'AccessManagerUnauthorizedAccount',
              [this.caller, this.roles.ADMIN.id], // Although PUBLIC_ROLE is required, admin ops are not subject to target function roles
            );
          });
        },
        notRequiredPublicRole: getAccessPath,
      });
    },
  });
}

/**
 * @requires this.{manager,roles,calldata,role}
 */
function shouldBehaveLikeRoleAdminOperation(roleAdmin) {
  const getAccessPath = COMMON_GET_ACCESS_PATH;
  getAccessPath.roleGranted.roleWithGrantDelay.callerWithExecutionDelay.after = function () {
    beforeEach('set operation delay', async function () {
      await mine();
      this.scheduleIn = this.executionDelay; // For shouldBehaveLikeSchedulableOperation
    });
    shouldBehaveLikeSchedulableOperation(COMMON_SCHEDULABLE_PATH);
  };
  getAccessPath.roleGranted.roleWithoutGrantDelay.callerWithExecutionDelay = function () {
    beforeEach('set execution delay', async function () {
      this.scheduleIn = this.executionDelay; // For shouldBehaveLikeSchedulableOperation
    });
    shouldBehaveLikeSchedulableOperation(COMMON_SCHEDULABLE_PATH);
  };

  beforeEach('set target as manager', function () {
    this.target = this.manager;
  });

  shouldBehaveLikeARestrictedOperation({
    managerCaller: COMMON_IS_EXECUTING_PATH,
    externalCaller: function () {
      shouldBehaveLikeHasRole({
        requiredPublicRole: function () {
          it('reverts as AccessManagerUnauthorizedAccount', async function () {
            await expectRevertCustomError(
              web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller }),
              'AccessManagerUnauthorizedAccount',
              [this.caller, roleAdmin], // Role admin ops require the role's admin
            );
          });
        },
        notRequiredPublicRole: getAccessPath,
      });
    },
  });
}

// ============ RESTRICTED OPERATION HELPERS ============

/**
 * @requires this.{manager,roles,calldata,role}
 */
function shouldBehaveLikeAManagedRestrictedOperation() {
  function revertUnauthorized() {
    it('reverts as AccessManagedUnauthorized', async function () {
      await expectRevertCustomError(
        web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller }),
        'AccessManagedUnauthorized',
        [this.caller],
      );
    });
  }

  const getAccessPath = COMMON_GET_ACCESS_PATH;

  getAccessPath.roleGranted.roleWithGrantDelay.callerWithExecutionDelay.before = revertUnauthorized;
  getAccessPath.roleGranted.roleWithGrantDelay.callerWithoutExecutionDelay.before = revertUnauthorized;
  getAccessPath.roleNotGranted = revertUnauthorized;

  getAccessPath.roleGranted.roleWithGrantDelay.callerWithExecutionDelay.after = function () {
    beforeEach('consume previously set grant delay', async function () {
      // Consume previously set delay
      await mine();
      this.scheduleIn = this.executionDelay; // For shouldBehaveLikeSchedulableOperation
    });
    shouldBehaveLikeSchedulableOperation(COMMON_SCHEDULABLE_PATH);
  };
  getAccessPath.roleGranted.roleWithoutGrantDelay.callerWithExecutionDelay = function () {
    beforeEach('consume previously set grant delay', async function () {
      this.scheduleIn = this.executionDelay; // For shouldBehaveLikeSchedulableOperation
    });
    shouldBehaveLikeSchedulableOperation(COMMON_SCHEDULABLE_PATH);
  };

  const isExecutingPath = COMMON_IS_EXECUTING_PATH;
  isExecutingPath.notExecuting = revertUnauthorized;

  shouldBehaveLikeCanCall({
    closed: revertUnauthorized,
    open: {
      managerCaller: isExecutingPath,
      externalCaller: {
        requiredPublicRole: function () {
          it('succeeds', async function () {
            await web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller });
          });
        },
        notRequiredPublicRole: getAccessPath,
      },
    },
  });
}

// ============ HELPERS ============

/**
 * @requires this.{manager, caller, target, calldata}
 */
async function scheduleOperation(manager, { caller, target, calldata, delay }) {
  const timestamp = await time.latest();
  const scheduledAt = timestamp.addn(1);
  await setNextBlockTimestamp(scheduledAt); // Fix next block timestamp for predictability
  await manager.schedule(target, calldata, scheduledAt.add(delay), {
    from: caller,
  });

  return {
    scheduledAt: scheduledAt,
    operationId: await manager.hashOperation(caller, target, calldata),
  };
}

/**
 * @requires this.{target, calldata, caller}
 */
// function web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller }) {
//   return web3.eth.sendTransaction({ to: this.target.address, data: this.calldata, from: this.caller });
// }

module.exports = {
  // MODE HELPERS
  shouldBehaveLikeClosable,
  // DELAY HELPERS
  shouldBehaveLikeDelay,
  // OPERATION HELPERS
  shouldBehaveLikeSchedulableOperation,
  // METHOD HELPERS
  shouldBehaveLikeCanCall,
  shouldBehaveLikeGetAccess,
  shouldBehaveLikeHasRole,
  // ADMIN OPERATION HELPERS
  shouldBehaveLikeDelayedAdminOperation,
  shouldBehaveLikeNotDelayedAdminOperation,
  shouldBehaveLikeRoleAdminOperation,
  // RESTRICTED OPERATION HELPERS
  shouldBehaveLikeAManagedRestrictedOperation,
  // HELPERS
  scheduleOperation,
};
