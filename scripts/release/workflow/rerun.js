module.exports = ({ github }) =>
  github.rest.actions.createWorkflowDispatch({
    owner: context.repo.owner,
    repo: context.repo.repo,
    workflow_id: 'release-cycle.yml',
    ref: process.env.GITHUB_REF_NAME,
  });
