"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

// Commented out: Manual creation is disabled in favor of employee self-signup with admin approval
// import { createEmployee, updateEmployee } from "@/app/admin/employees/actions";
import { updateEmployee } from "@/app/admin/employees/actions";
import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { useConfirmSubmit } from "@/components/forms/use-confirm-submit";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useFormValidation } from "@/hooks/use-form-validation";
import { employeeConfirmation } from "@/lib/admin/confirmations";
import {
  /* Commented out: Manual creation schemas disabled in favor of self-signup with admin approval
  createEmployeeSchema,
  readCreateEmployee,
  */
  readUpdateEmployee,
  updateEmployeeSchema,
} from "@/lib/admin/employee-schema";
import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  initialFormState,
  validator,
  type FormState,
} from "@/lib/auth/validation";

// Commented out: Manual creation validation disabled in favor of self-signup with admin approval
// const validateCreate = validator(createEmployeeSchema, readCreateEmployee);
const validateUpdate = validator(updateEmployeeSchema, readUpdateEmployee);
import { cn } from "@/lib/utils";
import type { AppRole, EmployeeCategory, Profile } from "@/types/database";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: EmployeeCategory[];
  /** Edit mode when provided. */
  employee?: Profile;
  currentUserId: string;
  serviceRoleConfigured: boolean;
};

type EditEmployeeFormProps = {
  onOpenChange: (open: boolean) => void;
  categories: EmployeeCategory[];
  employee: Profile;
  currentUserId: string;
};

export function EmployeeFormDialog(props: Props) {
  // Remount the form each time the dialog opens so state starts fresh.
  // Note: Manual employee creation by admin is disabled in favor of self-signup with admin approval.
  // This dialog is now used exclusively for editing existing employees.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {props.open && props.employee ? (
          <EmployeeForm
            key={props.employee.id}
            onOpenChange={props.onOpenChange}
            categories={props.categories}
            employee={props.employee}
            currentUserId={props.currentUserId}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EmployeeForm({ onOpenChange, categories, employee, currentUserId }: EditEmployeeFormProps) {

  const isSelf = employee.id === currentUserId;
  const [state, action, pending] = useActionState<FormState, FormData>(
    updateEmployee,
    initialFormState,
  );
  const [role, setRole] = useState<AppRole>(employee.role);
  const { errors, showServerMessage, formProps } = useFormValidation(validateUpdate, state);
  const confirm = useConfirmSubmit((fd) => employeeConfirmation(employee, fd));
  const v = state.values ?? {};

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      onOpenChange(false);
    }
  }, [state, onOpenChange]);

  return (
    <form action={action} {...formProps} onSubmit={confirm.wrap(formProps.onSubmit)} className="space-y-5">
      <DialogHeader>
        <DialogTitle>Edit employee</DialogTitle>
        <DialogDescription>
          Update details, role, category or account status.
        </DialogDescription>
      </DialogHeader>

      {state.status === "error" && showServerMessage && <FormMessage status="error" message={state.message} />}
      <input type="hidden" name="id" value={employee.id} />

      <FormField id="full_name" label="Full name" error={errors.full_name}>
        <Input
          {...fieldA11y("full_name", errors.full_name)}
          name="full_name"
          autoComplete="off"
          maxLength={NAME_MAX_LENGTH}
          defaultValue={v.full_name ?? employee.full_name}
          required
        />
      </FormField>

      <FormField id="email" label="Email" error={errors.email} hint="Email changes are not available yet.">
        <Input
          {...fieldA11y("email", errors.email, "x")}
          name="email"
          type="email"
          autoComplete="off"
          spellCheck={false}
          maxLength={EMAIL_MAX_LENGTH}
          defaultValue={v.email ?? employee.email}
          readOnly
          disabled
          required
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="role" label="Role" error={errors.role} hint={isSelf ? "You can't change your own role." : undefined}>
          <NativeSelect
            {...fieldA11y("role", errors.role)}
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as AppRole)}
            disabled={isSelf}
          >
            <option value="employee">Employee</option>
            <option value="admin">Administrator</option>
          </NativeSelect>
          {isSelf && <input type="hidden" name="role" value={role} />}
        </FormField>

        <FormField id="employee_category" label="Category" error={errors.employee_category}>
          <NativeSelect
            {...fieldA11y("employee_category", errors.employee_category)}
            name="employee_category"
            defaultValue={v.employee_category ?? employee.employee_category ?? ""}
          >
            <option value="">{role === "admin" ? "None" : "Select a category…"}</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>

      <label
        className={cn(
          "flex items-start gap-3 rounded-lg border p-3 text-sm",
          isSelf ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        )}
      >
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={v.is_active !== undefined ? v.is_active === "on" : employee.is_active}
          disabled={isSelf}
          className="mt-0.5 size-4 accent-primary"
        />
        {isSelf && <input type="hidden" name="is_active" value="on" />}
        <span>
          <span className="block font-medium">Account active</span>
          <span className="text-muted-foreground">
            {isSelf ? "You can't deactivate your own account." : "Inactive users are signed out and cannot sign in."}
          </span>
        </span>
      </label>

      {/*
        Commented out: Manual creation access options (invitation email / temporary password)
        are disabled in favor of employee self-signup with administrator approval.
      */}

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save changes
        </SubmitButton>
      </DialogFooter>
      {confirm.dialog}
    </form>
  );
}
