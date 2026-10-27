import { saveStaffCredentialAction } from "../actions";
import { StaffCardCredentials } from "./StaffCardCredentials";

export function StaffCardCredentialsWithActions(props: Parameters<typeof StaffCardCredentials>[0]) {
  return <StaffCardCredentials {...props} editAction={saveStaffCredentialAction} />;
}
