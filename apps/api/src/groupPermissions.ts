import { z } from "zod";

export const GroupPermissionModeSchema = z.enum(["everyone", "admins"]);

export const GroupPermissionsSchema = z.object({
  sendMessages: GroupPermissionModeSchema,
  sendMedia: GroupPermissionModeSchema,
  addMembers: GroupPermissionModeSchema,
  editGroupInfo: GroupPermissionModeSchema,
  pinMessages: GroupPermissionModeSchema,
  createPolls: GroupPermissionModeSchema,
}).strict();

export type GroupPermissions = z.infer<typeof GroupPermissionsSchema>;
export type GroupPermissionKey = keyof GroupPermissions;

export const DEFAULT_GROUP_PERMISSIONS: GroupPermissions = {
  sendMessages: "everyone",
  sendMedia: "everyone",
  addMembers: "admins",
  editGroupInfo: "admins",
  pinMessages: "everyone",
  createPolls: "everyone",
};

export function canPerformGroupAction(role: string, mode: GroupPermissions[GroupPermissionKey]): boolean {
  return mode === "everyone" || role === "owner" || role === "admin";
}
