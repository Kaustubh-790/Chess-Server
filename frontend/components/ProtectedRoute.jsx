import React, { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Navigate } from "react-router-dom";

const ProtectedRoute = ({ children }) => {
  const { currentUser, isAuthenticated, loading } = useAuth();

  console.log("protected route", currentUser, loading, isAuthenticated);

  if (loading) {
    return <div>loading</div>;
  }

  if (!isAuthenticated) {
    console.log("not authenticated");
    return <Navigate to="/auth" replace />;
  }

  console.log("user authenticated");
  return <>{children}</>;
};

export default ProtectedRoute;
