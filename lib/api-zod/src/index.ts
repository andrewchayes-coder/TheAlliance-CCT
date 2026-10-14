export * from "./generated/api";
export * from "./generated/types";
// Path schemas share these names with generated query interfaces; prefer schemas here.
export { GetAdminVolunteerHoursParams, AddAdminVolunteerHoursParams,
  UpdateAdminVolunteerHoursParams, DeleteAdminVolunteerHoursParams } from "./generated/api";
// Orval also emits multipart body interfaces; prefer inferred Zod body types.
export type { UploadAccountPhotoBody, UploadManagedAccountPhotoBody } from "./generated/types";
