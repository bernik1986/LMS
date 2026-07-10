export type UserRole = "admin" | "student";

export type DemoSession = {
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    status: "active" | "inactive";
  };
};

export const demoAdminSession: DemoSession = {
  user: {
    id: "admin-1",
    email: "admin@example.com",
    name: "Platform Admin",
    role: "admin",
    status: "active"
  }
};

export const demoStudentSession: DemoSession = {
  user: {
    id: "student-1",
    email: "student@example.com",
    name: "Alex Student",
    role: "student",
    status: "active"
  }
};

export function canAccessAdmin(session: DemoSession | null) {
  return session?.user.role === "admin" && session.user.status === "active";
}

export function canAccessStudentCabinet(session: DemoSession | null) {
  return session?.user.role === "student" && session.user.status === "active";
}
