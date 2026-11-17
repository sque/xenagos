"""Models the server sends to the viewer. Their TypeScript types are generated with the plan's (`xenagos.schema`)."""

from xenagos.plan import Model


class ReviewInfo(Model):
    id: str
    repo: str
    label: str
    base: str
    head: str
    branch: str | None
